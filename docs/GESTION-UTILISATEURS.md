# Comptes de l’équipe

Trois rôles sont disponibles dans **Mon profil → Les personnes de l’équipe** :

- **Membre** : consulte et modifie ses propres temps.
- **Responsable** : consulte les temps, rapports et journal de l’équipe.
- **Administrateur** : dispose aussi de la gestion des comptes et des rôles. Plusieurs personnes peuvent être administrateurs.

Les administrateurs peuvent créer un compte, modifier son identifiant, réinitialiser son mot de passe, changer son rôle ou retirer son accès. Le dernier administrateur actif ne peut pas être rétrogradé. Un changement de rôle ferme les sessions de la personne concernée.

**Modifier l’identifiant** conserve le mot de passe, les heures, les affectations et les sessions. Les doublons et les modifications concurrentes sont refusés.

**Supprimer** demande de saisir l’identifiant pour confirmer, désactive le compte et ferme ses sessions. Les heures et leur auteur restent disponibles dans les rapports et exports. Il est impossible de supprimer son propre compte ou un compte ayant un chrono actif. Les comptes retirés restent consultables avec **Afficher les comptes retirés**.

Les changements sont enregistrés dans le journal. La migration ajoute uniquement la table de droits `user_admins` : les lignes des tables existantes sont conservées. Le premier administrateur est désigné explicitement par le paramètre privé de déploiement `INITIAL_ADMIN_USERNAME`, jamais par un identifiant inscrit dans le dépôt.
