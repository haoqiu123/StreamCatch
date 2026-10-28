#!/bin/zsh
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
task_dir="${0:A:h}"
python3 "$task_dir/native/install.py" --uninstall
read '?按回车关闭…'
