import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'native'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
host=load('host');installer=load('install')
DASH='''<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT8S"><Period><AdaptationSet mimeType="video/mp4"><Representation id="v" width="1280" height="720" bandwidth="100000" codecs="avc1.64001f"><BaseURL>https://iad.cdn.nv.instructuremedia.com/test/</BaseURL><SegmentTemplate timescale="1" initialization="init.mp4" media="chunk-$Number$.m4s"><SegmentTimeline><S d="4" r="1"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>'''

class NativeTests(unittest.TestCase):
    def test_bilibili_english_route_and_cdn_use_exact_canonical_part(self):
        english='https://www.bilibili.com/en/video/BV1AfJD6eE3W/?p=2&trackid=FAKE'
        canonical='https://www.bilibili.com/video/BV1AfJD6eE3W/?p=2'
        self.assertEqual(host.canonical_page(english),canonical)
        for value in ['https://www.bilibili.com.evil.test/video/BV1AfJD6eE3W/','https://u:p@www.bilibili.com/video/BV1AfJD6eE3W/']:
            if '@' in value:
                with self.assertRaises(ValueError):host.canonical_page(value)
            else:self.assertIsNone(host.canonical_page(value))
        with patch.object(host.shutil,'which',return_value='/usr/bin/fake'):
            self.assertEqual(host.command({'url':english},Path('/tmp/videos'))[-1],canonical)
            self.assertEqual(host.command({'url':'https://upos.example.bilivideo.com/video.m4s','pageUrl':english},Path('/tmp/videos'))[-1],canonical)
            self.assertEqual(host.command({'url':'https://other.test/video.mp4','pageUrl':english},Path('/tmp/videos'))[-1],'https://other.test/video.mp4')

    def test_modern_bili_layout_uses_matching_view_metadata_and_honors_rate_limit(self):
        from yt_dlp.extractor.bilibili import BiliBiliIE
        from yt_dlp.utils import ExtractorError
        requested='BV1AfJD6eE3W'
        reply={'code':0,'data':{'View':{'bvid':requested,'aid':123,'cid':456,'title':'Fixture video','owner':{}}}}
        def fake_extract(instance,url):
            self.assertEqual(url,'https://www.bilibili.com/video/'+requested+'/')
            state=instance._search_json(r'window\.__INITIAL_STATE__\s*=','<html>Modern translated page</html>','initial state',requested[2:],default=None)
            self.assertEqual(state['videoData']['bvid'],requested)
            return {'id':requested,'duration':8,'formats':[{'url':'https://cdn.bilivideo.com/fixture.mp4','height':480}]}
        with patch.object(BiliBiliIE,'extract',fake_extract),patch.object(BiliBiliIE,'_sign_wbi',side_effect=lambda q,v:q),patch.object(BiliBiliIE,'_download_json',return_value=reply) as get:
            info=host.bilibili_info({'url':'https://www.bilibili.com/en/video/'+requested+'/'})
            self.assertEqual(info['id'],requested);self.assertEqual(info['extractor_key'],'BiliBili')
            self.assertEqual(get.call_args.kwargs['query']['bvid'],requested)
            get.return_value={'code':0,'data':{'View':{'bvid':'BVwrongvideo'}}}
            with self.assertRaises(ExtractorError):host.bilibili_info({'url':'https://www.bilibili.com/en/video/'+requested+'/'})

    def test_invalid_input_error_is_not_reported_as_unsupported_codec(self):
        text=host.download_error(['ERROR: Postprocessing: Error opening input files: Invalid data found when processing input'],1)
        self.assertIn('有效的完整媒体',text);self.assertNotIn('编码可能不受',text)

    def test_request_headers_are_a_strict_allowlist_and_403_has_an_actionable_message(self):
        with patch.object(host.shutil,'which',return_value='/usr/bin/fake'):
            args=host.command({'url':'https://cdn3.onlyfans.com/fixture.mp4','pageUrl':'https://onlyfans.com/fixture',
                'requestHeaders':{'userAgent':'Chrome fixture','origin':'https://onlyfans.com','referer':'https://onlyfans.com/player','Cookie':'PRIVATE','Authorization':'PRIVATE'}},Path('/tmp/videos'))
            self.assertEqual(args[args.index('--user-agent')+1],'Chrome fixture')
            self.assertEqual(args[args.index('--referer')+1],'https://onlyfans.com/player')
            self.assertIn('Origin:https://onlyfans.com',args);self.assertNotIn('PRIVATE',str(args))
            for ua in ['-bad','Chrome\r\nCookie: BAD']:
                with self.assertRaises(ValueError):host.command({'url':'https://cdn.test/a.mp4','requestHeaders':{'userAgent':ua}},Path('/tmp/videos'))
        message=host.download_error(['ERROR: [generic] HTTP Error 403: Forbidden'],1)
        self.assertIn('登录状态',message);self.assertIn('403 本身不代表 DRM',message)

    def test_backup_formats_keep_identity_and_quality_without_mutating_original(self):
        value={'id':'same-video','extractor_key':'BiliBili','duration':8,'formats':[{'url':'https://primary.bilivideo.com/a.m4s','height':1080,'_streamcatch_backups':['https://backup.bilivideo.com/a.m4s']}]}
        renewed=host.backup_media_info(value)
        self.assertEqual(renewed['id'],value['id']);self.assertEqual(renewed['formats'][0]['height'],1080)
        self.assertIn('backup.',renewed['formats'][0]['url']);self.assertIn('primary.',value['formats'][0]['url'])
        self.assertIsNone(host.backup_media_info({'extractor_key':'Generic','formats':[]}))

    def test_failed_primary_retries_one_provided_backup_in_a_fresh_private_folder(self):
        info={'id':'fixture','extractor_key':'BiliBili','duration':8,'formats':[{'url':'https://primary.bilivideo.com/a','_streamcatch_backups':['https://backup.bilivideo.com/a']}]}
        attempts=[];sent=[]
        def command(message,destination,cookie_path,info_path):
            attempts.append((destination,json.loads(Path(info_path).read_text())))
            return ['fake',str(destination)]
        def popen(args,**kwargs):
            if len(attempts)==1:return SimpleNamespace(stdout=iter(['ERROR: HTTP Error 567\n']),wait=lambda:1)
            source=Path(args[1])/'video.mp4';source.write_bytes(b'validated bytes')
            return SimpleNamespace(stdout=iter([f'SC_FILE:{source}\n']),wait=lambda:0)
        with tempfile.TemporaryDirectory() as tmp,patch.object(host.Path,'home',return_value=Path(tmp)), \
             patch.object(host,'bilibili_info',return_value=info),patch.object(host,'command',side_effect=command), \
             patch.object(host.subprocess,'Popen',side_effect=popen),patch.object(host,'send',side_effect=sent.append), \
             patch.object(host,'ensure_compatible'),patch.object(host,'media_info',return_value={'duration':8}):
            host.cancelled.clear();host.download({'url':'https://www.bilibili.com/video/BV1AfJD6eE3W/'})
            self.assertEqual(len(attempts),2);self.assertNotEqual(attempts[0][0],attempts[1][0])
            self.assertIn('backup.',attempts[1][1]['formats'][0]['url'])
            self.assertEqual(sent[-1]['type'],'done');self.assertTrue(Path(sent[-1]['files'][0]).is_file())
            self.assertFalse(list((Path(tmp)/'Downloads/StreamCatch').glob('.streamcatch-job-*')))

    def test_publish_never_overwrites_an_existing_or_corrupt_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);stage=base/'stage';stage.mkdir();output=base/'downloads';output.mkdir()
            source=stage/'video.mkv';source.write_bytes(b'validated MP4 bytes')
            old=output/'video.mp4';old.write_bytes(b'old corrupt bytes')
            host.cancelled.clear();published=Path(host.publish_mp4(source,output))
            self.assertEqual(published.name,'video (2).mp4');self.assertEqual(published.read_bytes(),source.read_bytes())
            self.assertEqual(old.read_bytes(),b'old corrupt bytes');self.assertEqual(published.stat().st_mode&0o777,0o600)
            host.cancelled.set()
            with self.assertRaises(host.DownloadCancelled):host.publish_mp4(source,output)
            host.cancelled.clear()
    def test_browser_mpd_parsed_without_retrieving_manifest_and_command_uses_info(self):
        message={'url':'https://nv.instructuremedia.com/test/blocked-entry','dashManifest':DASH,'title':'Canvas lecture'}
        info=host.browser_dash_info(message)
        self.assertEqual(info['duration'],8)
        self.assertEqual(info['formats'][0]['height'],720)
        self.assertEqual(len(info['formats'][0]['fragments']),3)
        with patch.object(host.shutil,'which',return_value='/usr/bin/fake'),patch.object(host.importlib.util,'find_spec',return_value=object()):
            args=host.command(message,Path('/tmp/videos'),info_path='/tmp/private-info.json')
        self.assertEqual(args[-2:],['--load-info-json','/tmp/private-info.json'])
        self.assertNotIn(message['url'],args)
        self.assertNotIn('--enable-file-urls',args)

    def test_browser_mpd_rejects_drm_entities_non_http_and_expansion(self):
        invalid=[DASH.replace('<Period>','<Period><ContentProtection schemeIdUri="urn:uuid:test"/>'),
                 '<!DOCTYPE MPD [<!ENTITY x "x">]>'+DASH,
                 DASH.replace('https://iad.cdn.nv.instructuremedia.com/test/','file:///etc/'),
                 DASH.replace('init.mp4','file:///etc/passwd'),
                 DASH.replace('r="1"','r="1000000000"'),
                 DASH.replace('r="1"','r="-1"').replace('d="4"','d="0"'),
                 DASH.replace('type="static"','type="dynamic"'),
                 '<html>login</html>','x'*(256*1024+1)]
        for xml in invalid:
            with self.subTest(xml=xml[:60]), self.assertRaises(ValueError):
                host.browser_dash_info({'url':'https://nv.instructuremedia.com/test/entry','dashManifest':xml})
        with self.assertRaises(ValueError):host.browser_dash_info({'url':'https://evil.test/entry','dashManifest':DASH})

    def test_browser_manifest_temporary_info_is_private_and_removed_on_error(self):
        seen=[]
        def command(message,output,cookie_path,info_path):
            p=Path(info_path);seen.append(p)
            self.assertEqual(p.stat().st_mode&0o777,0o600)
            self.assertEqual(json.loads(p.read_text())['id'],'test')
            return ['fake']
        process=SimpleNamespace(stdout=iter(['ERROR: test failure\n']),wait=lambda:1)
        with tempfile.TemporaryDirectory() as tmp,patch.object(host.Path,'home',return_value=Path(tmp)), \
             patch.object(host,'browser_dash_info',return_value={'id':'test'}),patch.object(host,'command',side_effect=command), \
             patch.object(host.subprocess,'Popen',return_value=process),patch.object(host,'send'):
            host.cancelled.clear();host.download({'url':'https://nv.instructuremedia.com/test/entry'})
        self.assertEqual(len(seen),1);self.assertFalse(seen[0].exists())

    def test_cookie_scope_and_permissions(self):
        cookies=[{'domain':'.example.com','path':'/','name':'session','value':'secret','httpOnly':True,'hostOnly':False},
                 {'domain':'.other.com','name':'unrelated','value':'never-share'},
                 {'domain':'.example.com','name':'bad\tname','value':'x'}]
        file=host.cookie_file(cookies,['https://learn.example.com/course'])
        try:
            text=Path(file).read_text()
            self.assertIn('#HttpOnly_.example.com\tTRUE',text)
            self.assertNotIn('never-share',text)
            self.assertNotIn('bad',text)
            self.assertEqual(Path(file).stat().st_mode&0o777,0o600)
        finally:os.unlink(file)

    def test_arguments_do_not_execute_shell_syntax(self):
        with patch.object(host.shutil,'which',return_value='/usr/bin/fake'):
            args=host.command({'url':'https://example.com/$(touch%20bad)','pageUrl':'https://example.com/','maxHeight':1080},Path('/tmp/videos'))
        self.assertEqual(args[-2],'--');self.assertEqual(args[-1],'https://example.com/$(touch%20bad)')
        self.assertIn('--ignore-config',args)
        self.assertIn('--abort-on-unavailable-fragments',args)
        self.assertIn('bv*[height<=1080]+ba/b[height<=1080]',args)
        self.assertEqual(args[args.index('--merge-output-format')+1],'mkv')
        self.assertNotIn('--remux-video',args)
        self.assertIn('--no-continue',args)
        self.assertIn('--no-embed-subs',args)
        self.assertNotIn('mp4/mkv',args)
        self.assertEqual(args[args.index('--format-sort')+1],'res,vcodec:h264,acodec:aac,ext:mp4:m4a')

    def test_youtube_adaptive_track_uses_original_watch_page(self):
        page='https://www.youtube.com/watch?v=ABCDEFGHIJK'
        with patch.object(host.shutil,'which',return_value='/usr/bin/fake'):
            args=host.command({'url':'https://rr1---sn.example.googlevideo.com/videoplayback?itag=140','pageUrl':page},Path('/tmp/videos'))
            self.assertEqual(args[-1],page)
            for untrusted in ('https://youtube.com.evil.test/watch?v=ABCDEFGHIJK','https://www.youtube.com/feed/subscriptions'):
                args=host.command({'url':'https://rr1.googlevideo.com/videoplayback','pageUrl':untrusted},Path('/tmp/videos'))
                self.assertEqual(args[-1],'https://rr1.googlevideo.com/videoplayback')
            args=host.command({'url':'https://notgooglevideo.com/videoplayback','pageUrl':page},Path('/tmp/videos'))
            self.assertEqual(args[-1],'https://notgooglevideo.com/videoplayback')

    def test_canvas_uses_supported_browser_networking_only_for_canvas_hosts(self):
        with patch.object(host.shutil,'which',return_value='/usr/bin/fake'),patch.object(host.importlib.util,'find_spec',return_value=object()):
            args=host.command({'url':'https://nv.instructuremedia.com/media/video/manifest.mpd'},Path('/tmp/videos'))
            self.assertEqual(args[args.index('--impersonate')+1],'chrome')
            self.assertIn('generic:impersonate=chrome',args)
            ordinary=host.command({'url':'https://example.com/video.mp4'},Path('/tmp/videos'))
            self.assertNotIn('--impersonate',ordinary)
        with patch.object(host.shutil,'which',return_value='/usr/bin/fake'),patch.object(host.importlib.util,'find_spec',return_value=None):
            with self.assertRaisesRegex(ValueError,'浏览器兼容网络组件'):
                host.command({'url':'https://nv.instructuremedia.com/media/video/manifest.mpd'},Path('/tmp/videos'))

    def test_audio_only_download_cannot_report_completion(self):
        with patch.object(host,'media_info',return_value={'video':None,'pixel':None,'audio':'aac','duration':10}):
            with self.assertRaisesRegex(ValueError,'没有视频画面'):
                host.ensure_compatible(Path('/unused/audio-only.mp4'))

    def test_quicktime_requires_actual_h264_8bit_and_aac(self):
        base={'video':'h264','pixel':'yuv420p','audio':'aac'}
        self.assertTrue(host.quicktime_compatible(base))
        self.assertTrue(host.quicktime_compatible({**base,'audio':None}))
        for change in ({'video':'vp9'},{'video':'av1'},{'audio':'opus'},{'pixel':'yuv420p10le'},{'pixel':'yuv422p'}):
            self.assertFalse(host.quicktime_compatible({**base,**change}))

    def test_files_outside_private_stage_never_report_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            user=Path(tmp);folder=user/'Downloads/StreamCatch';folder.mkdir(parents=True)
            video=folder/'unexpected.mkv';video.write_bytes(b'video')
            process=SimpleNamespace(stdout=iter([f'SC_FILE:{video}\n']),wait=lambda:0)
            sent=[]
            with patch.object(host.Path,'home',return_value=user),patch.object(host,'command',return_value=['fake']), \
                 patch.object(host.subprocess,'Popen',return_value=process),patch.object(host,'send',side_effect=sent.append):
                host.cancelled.clear();host.download({'url':'https://example.com/video'})
            self.assertEqual(sent[-1]['type'],'error')
            self.assertIn('下载未完成',sent[-1]['error'])
            self.assertFalse(any(item['type']=='done' for item in sent))
            self.assertEqual(host.completed_files,[])

    def test_failed_remux_reports_mp4_failure_without_source_url(self):
        process=SimpleNamespace(stdout=iter(['ERROR: Postprocessing: Could not find tag for codec ffv1 at https://example.com/source?token=secret\n']),wait=lambda:1)
        sent=[]
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(host.Path,'home',return_value=Path(tmp)),patch.object(host,'command',return_value=['fake']), \
             patch.object(host.subprocess,'Popen',return_value=process),patch.object(host,'send',side_effect=sent.append):
            host.cancelled.clear();host.download({'url':'https://example.com/video'})
        self.assertEqual(sent[-1]['type'],'error')
        self.assertIn('音视频合并失败',sent[-1]['error'])
        self.assertNotIn('secret',str(sent))
        self.assertFalse(any(item['type']=='done' for item in sent))
        self.assertEqual(host.completed_files,[])

    def command_template(self, title=None, url='https://example.com/video'):
        message={'url':url}
        if title is not None:message['title']=title
        with patch.object(host.shutil,'which',return_value='/usr/bin/fake'):
            args=host.command(message,Path('/tmp/videos'))
        return args[args.index('--output')+1]

    def test_custom_filename_template_is_literal_and_keeps_source_identity(self):
        title='100% %(title)s `echo hello` $(touch bad).mp4'
        template=self.command_template(title)
        self.assertTrue(template.startswith('100%% %%(title)s `echo hello` $(touch bad) ['))
        self.assertTrue(template.endswith('].%(ext)s'))
        self.assertRegex(template,r'\[[0-9a-f]{10}\]\.\%\(ext\)s$')
        self.assertNotIn('%(id)',template)
        self.assertNotEqual(template,self.command_template(title,'https://example.com/other'))
        signed=self.command_template('Course','https://example.com/a.m3u8?playSessionId=private-token')
        self.assertRegex(signed,r'^Course \[[0-9a-f]{10}\]\.\%\(ext\)s$')
        self.assertNotIn('private-token',signed)
        self.assertNotIn('playSessionId',signed)
        self.assertTrue(self.command_template().startswith('%(title).150B ['))
        self.assertEqual(self.command_template(''),self.command_template())

    def test_custom_filename_cannot_traverse_or_include_control_characters(self):
        title=host.output_title('../../outside\\file\n\r\x00\x7f\u202e.mp4')
        self.assertFalse(title.startswith('.'))
        for forbidden in ('/','\\','\n','\r','\x00','\x7f','\u202e'):
            self.assertNotIn(forbidden,title)
        self.assertEqual(host.output_title(' CON.mp4 '),'_CON')
        self.assertLessEqual(len(host.output_title('视频课程'*100).encode('utf-8')),150)
        for value in (' . ',[],{},42):
            with self.assertRaises(ValueError):host.output_title(value)

    def run_messages(self, messages):
        frames=b''
        for message in messages:
            payload=json.dumps(message).encode('utf-8')
            frames+=struct.pack('<I',len(payload))+payload
        sent=[]
        with patch.object(host.sys,'stdin',SimpleNamespace(buffer=io.BytesIO(frames))), \
             patch.object(host,'send',side_effect=sent.append), \
             patch.object(host,'cancel'),patch.object(host,'worker',None):
            host.main()
        return sent

    def test_reveal_and_open_downloads_protocol(self):
        with tempfile.TemporaryDirectory() as tmp:
            user=Path(tmp);folder=user/'Downloads/StreamCatch'
            with patch.object(host.Path,'home',return_value=user),patch.object(host.subprocess,'Popen') as popen:
                opened=self.run_messages([{'cmd':'openDownloads'}])
                self.assertTrue(folder.is_dir())
                self.assertEqual(opened,[{'type':'opened','command':'openDownloads','path':str(folder)}])
                popen.assert_called_with(['/usr/bin/open',str(folder)],stdout=host.subprocess.DEVNULL,stderr=host.subprocess.DEVNULL)
                video=folder/'video.mp4';video.write_bytes(b'video')
                with patch.object(host,'completed_files',[str(video)]):
                    revealed=self.run_messages([{'cmd':'revealFile','path':str(video)},{'cmd':'reveal','index':0}])
                self.assertEqual([m['type'] for m in revealed],['revealed','revealed'])
                self.assertEqual([m['path'] for m in revealed],[str(video.resolve()),str(video.resolve())])
                popen.assert_called_with(['/usr/bin/open','-R',str(video.resolve())],stdout=host.subprocess.DEVNULL,stderr=host.subprocess.DEVNULL)

    def test_reveal_refuses_outside_paths_and_symlink_escapes(self):
        with tempfile.TemporaryDirectory() as tmp:
            user=Path(tmp);folder=user/'Downloads/StreamCatch';folder.mkdir(parents=True)
            outside=user/'outside.mp4';outside.write_bytes(b'outside')
            linked=folder/'linked.mp4';linked.symlink_to(outside)
            with patch.object(host.Path,'home',return_value=user),patch.object(host.subprocess,'Popen') as popen:
                paths=[str(outside),str(linked),str(folder/'../../outside.mp4'),str(folder),str(folder/'missing.mp4'),'relative.mp4','']
                errors=self.run_messages([{'cmd':'revealFile','path':path} for path in paths])
                self.assertEqual(len(errors),len(paths))
                self.assertTrue(all(m['type']=='commandError' and m['command']=='revealFile' for m in errors))
                popen.assert_not_called()

    def test_reject_untrusted_protocols_and_credentials(self):
        for value in ['file:///etc/passwd','javascript:alert(1)','https://u:p@example.com/x','https://example.com/\n--exec']:
            with self.assertRaises(ValueError):host.valid_url(value)

    def test_installer_and_uninstaller_in_temporary_home(self):
        with tempfile.TemporaryDirectory() as tmp:
            user=Path(tmp);dest=user/'Library/Application Support/StreamCatch'
            with patch.object(installer,'HOME',user),patch.object(installer,'DEST',dest),patch.object(installer.shutil,'which',return_value='/usr/bin/true'),patch.object(installer.sys,'argv',['install.py']):
                installer.main()
                manifest=user/'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.streamcatch.helper.json'
                content=json.loads(manifest.read_text())
                self.assertEqual(content['allowed_origins'],[f'chrome-extension://{installer.extension_id()}/'])
                self.assertTrue(Path(content['path']).is_file())
                self.assertEqual(Path(content['path']).stat().st_mode&0o777,0o700)
                with patch.object(installer.sys,'argv',['install.py','--uninstall']):installer.main()
                self.assertFalse(dest.exists());self.assertFalse(manifest.exists())

if __name__=='__main__':unittest.main()
