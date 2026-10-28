"""Run the macOS shell installer with fake tools and an isolated home, never Homebrew."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FAKE_TOOL = r'''import json,os,pathlib,sys
home=pathlib.Path(os.environ['HOME']); tools=pathlib.Path(os.environ['STREAMCATCH_TEST_TOOLS'])
with (home/'commands.jsonl').open('a') as out:out.write(json.dumps([pathlib.Path(sys.argv[0]).name,*sys.argv[1:]])+'\n')
name=pathlib.Path(sys.argv[0]).name
if name=='brew':
    for package in sys.argv[2:]:
        (tools/({'python':'python3'}.get(package,package))).symlink_to(tools/'tool')
elif sys.argv[1:3]==['-m','venv']:
    target=pathlib.Path(sys.argv[3])/'bin';target.mkdir(parents=True);(target/'python').symlink_to(tools/'tool')
elif sys.argv[1:3]==['-m','pip']:
    (home/'python-deps-ready').touch()
elif len(sys.argv)>1 and sys.argv[1]=='-c':
    sys.exit(0 if (home/'python-deps-ready').exists() else 1)
'''


@unittest.skipUnless(shutil.which('zsh'), 'zsh is required for installer smoke tests')
class InstallerTests(unittest.TestCase):
    def run_install(self, *, brew=True, reusable=False, answer='y\n\n'):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp); tools=home/'tools';tools.mkdir()
            tool=tools/'tool';tool.write_text('#!'+str(Path(sys.executable).resolve())+'\n'+FAKE_TOOL);tool.chmod(0o755)
            (tools/'ln').symlink_to(shutil.which('ln'))
            if brew:(tools/'brew').symlink_to(tool)
            if reusable:
                runtime=home/'Library/Application Support/StreamCatch/runtime/bin';runtime.mkdir(parents=True)
                (runtime/'python').symlink_to(tool)
                (home/'python-deps-ready').touch()
                for name in ('ffmpeg','node'):(tools/name).symlink_to(tool)
            source=(ROOT/'安装Mac助手.command').read_text()
            # Keep the real install logic, replacing the machine-wide PATH with fake tools.
            source=source.replace('export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"',
                                  'export PATH="$STREAMCATCH_TEST_TOOLS"')
            installer=home/'安装Mac助手.command';installer.write_text(source)
            result=subprocess.run([shutil.which('zsh'),str(installer)],input=answer,text=True,capture_output=True,
                                  env={**os.environ,'HOME':str(home),'STREAMCATCH_TEST_TOOLS':str(tools)},timeout=10)
            file=home/'commands.jsonl'
            calls=[json.loads(line) for line in file.read_text().splitlines()] if file.exists() else []
            return result,calls

    def test_fresh_install_prepares_all_tools_and_isolated_python_before_registration(self):
        result,calls=self.run_install()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(calls[0],['brew','install','python','ffmpeg','node'])
        self.assertTrue(any(call[1:3]==['-m','venv'] for call in calls))
        self.assertTrue(any(call[1:3]==['-m','pip'] for call in calls))
        self.assertTrue(calls[-1][1].endswith('/native/install.py'))

    def test_missing_homebrew_explains_the_next_step_without_installing(self):
        result,calls=self.run_install(brew=False,answer='\n')
        self.assertEqual(result.returncode,1)
        self.assertIn('https://brew.sh',result.stdout)
        self.assertEqual(calls,[])

    def test_declining_dependencies_does_not_install_or_register(self):
        result,calls=self.run_install(answer='n\n')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(calls,[])

    def test_existing_runtime_and_tools_do_not_need_homebrew_or_pip(self):
        result,calls=self.run_install(brew=False,reusable=True,answer='\n')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse(any(call[0]=='brew' or call[1:3]==['-m','pip'] for call in calls))
        self.assertTrue(calls[-1][1].endswith('/native/install.py'))


if __name__=='__main__':unittest.main()
