@echo off
setlocal
title Nginx UI - connexion SSH
set "TIMETEK_SSH_ALIAS=%~1"
if not defined TIMETEK_SSH_ALIAS if exist "%~dp0server.local.txt" set /p TIMETEK_SSH_ALIAS=<"%~dp0server.local.txt"
if not defined TIMETEK_SSH_ALIAS (
  echo Indiquez un alias SSH : "Ouvrir Nginx UI.cmd" ALIAS
  echo Ou placez cet alias dans server.local.txt, exclu de Git.
  pause
  exit /b 1
)
echo Connexion au serveur configure localement.
echo Ensuite, ouvrez http://127.0.0.1:9000 dans votre navigateur.
echo Gardez cette fenetre ouverte pendant l'utilisation.
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:9000:127.0.0.1:9000 "%TIMETEK_SSH_ALIAS%"
if errorlevel 1 pause
