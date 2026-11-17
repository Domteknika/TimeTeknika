@echo off
title Nginx UI - connexion SSH
echo Connexion a dtkserver (10.69.1.146).
echo Entrez votre mot de passe Ubuntu si demande.
echo Ensuite, ouvrez http://127.0.0.1:9000 dans votre navigateur.
echo Gardez cette fenetre ouverte pendant l'utilisation.
echo Pour terminer la connexion : Ctrl+C ou fermez cette fenetre.
echo.
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:9000:127.0.0.1:9000 dtkserver@10.69.1.146
if errorlevel 1 (
  echo.
  echo Connexion terminee ou impossible. Verifiez le reseau et les messages ci-dessus.
  echo Si le port 9000 est deja utilise, une autre connexion peut etre ouverte.
  pause
)
