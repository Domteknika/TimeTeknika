# Publication du dépôt public

Exécuter `pnpm check:public` avant chaque commit et chaque push. Cette commande est également exécutée par `pnpm release`. Elle contrôle les fichiers suivis et les nouveaux fichiers non ignorés, signale les formats de secrets connus et refuse les bases et configurations privées. Elle affiche les chemins et règles concernés, jamais les valeurs détectées.

Le fichier local ignoré `.private-identifiers.local.json` peut contenir une liste JSON de noms de connexion et autres identifiants à interdire. Il reste sur le poste et ne doit jamais être ajouté à Git. Le lanceur Nginx lit son alias SSH dans `server.local.txt`, également ignoré, ou dans son premier argument.

Les fichiers .env, bases SQLite, sauvegardes, clés privées et artefacts de test sont ignorés. Les comptes Alex, Emma et Lucas et les mots de passe présents dans les tests sont fictifs, réservés aux tests ou au mode de démonstration.

Ce contrôle n’est pas une garantie exhaustive : relire le diff et vérifier les images. Il examine les fichiers actuels, pas les anciens commits ni les fichiers intermédiaires déjà ajoutés à l’index. L’historique initial contient d’anciennes coordonnées SSH retirées des fichiers actuels ; un nouveau commit ne les efface pas de cet historique. Une purge de l’historique doit être coordonnée séparément avant une publication qui doit également exclure ces coordonnées.
