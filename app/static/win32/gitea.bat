@echo off
setlocal

set ELECTRON_RUN_AS_NODE=1
call "%~dp0..\..\..\GiteaDesktop.exe" "%~dp0..\cli.js" %*

endlocal
