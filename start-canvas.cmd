@echo off
rem Opens the line canvas page for all lines under lines\. Close this window to stop it.
cd /d "%~dp0"
set PYTHONUTF8=1
start "" http://127.0.0.1:8765/
python app\server.py --lines lines --port 8765
pause
