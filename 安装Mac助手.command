#!/bin/zsh
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
task_dir="${0:A:h}"
task_runtime="$HOME/Library/Application Support/StreamCatch/runtime/bin"
export PATH="$task_runtime:$PATH"
print 'StreamCatch 本地下载助手'
print '安装位置：当前用户的 Library/Application Support/StreamCatch。'
print '支持 Chrome、Edge、Brave；助手注册不需要管理员权限。'
task_deps=()
if [[ ! -x "$task_runtime/python" ]] && ! command -v python3 >/dev/null 2>&1; then task_deps+=(python); fi
if ! command -v ffmpeg >/dev/null 2>&1; then task_deps+=(ffmpeg); fi
if ! command -v node >/dev/null 2>&1; then task_deps+=(node); fi
if (( ${#task_deps} )); then
  if ! command -v brew >/dev/null 2>&1; then
    print '首次安装请先按 https://brew.sh 的说明安装 Homebrew，再运行此文件。'
    read '?按回车退出…'
    exit 1
  fi
  print "需要通过 Homebrew 安装：${task_deps[*]}（可能需要几分钟）。"
  read 'task_answer?现在安装这些依赖？[y/N] '
  if [[ "$task_answer" != [yY] ]]; then exit 0; fi
  brew install "${task_deps[@]}"
fi
if [[ ! -x "$task_runtime/python" ]]; then
  print '建立独立 Python 环境。'
  python3 -m venv "${task_runtime:h}"
fi
if ! "$task_runtime/python" -c 'import re,curl_cffi,yt_dlp.version; assert tuple(map(int,re.findall(r"\d+",yt_dlp.version.__version__)[:3])) >= (2026,10,26)' >/dev/null 2>&1; then
  print '从 PyPI 安装或更新 yt-dlp 和浏览器兼容组件。'
  "$task_runtime/python" -m pip install 'yt-dlp[default]>=2026.10.26' 'curl_cffi>=0.10,<0.17'
fi
if [[ ! -x "$task_runtime/ffmpeg" ]]; then ln -sf "$(command -v ffmpeg)" "$task_runtime/ffmpeg"; fi
"$task_runtime/python" "$task_dir/native/install.py"
read '?按回车关闭…'
