# Dispo

Une petite app pour dire à ses proches si on est dispo ou pas : en ligne, absent, occupé ou hors ligne,
avec un petit texte si on veut préciser (« en réunion », « je mange »...). Seules les personnes de son cercle voient le statut.

Ça tourne dans le navigateur, sur PC comme sur téléphone, et ça s'installe sur l'écran d'accueil.

## Les dossiers

- `web/` : l'app (TypeScript + Vite)
- `supabase/schema.sql` : la base de données et les règles d'accès
- `windows/` et `android/` : à venir (widget Windows, app Android)

## Lancer l'app chez soi

Il faut Node.js. Ensuite, dans le dossier `web` :

```
npm install
npm run dev
```

L'app est sur http://localhost:5173 et se recharge toute seule quand on modifie un fichier.
Pour fabriquer la version à mettre en ligne : `npm run build` (le résultat est dans `web/dist`).

Si ça plante, vérifier que le chemin du dossier ne contient pas de `&` : npm ne s'en sort pas sous Windows.
Dans ce cas on peut lancer les outils directement avec `node node_modules/vite/bin/vite.js`.

Où toucher à quoi :

- `src/app.ts` : les écrans et ce qu'ils font
- `src/style.css` : l'apparence
- `src/supabase.ts` : les états et leurs couleurs
- `src/config.ts` : l'adresse du serveur et sa clé publique

## Le serveur (Supabase)

Les comptes, les statuts et les photos sont stockés chez Supabase, avec l'offre gratuite (pas de carte bancaire).

1. Créer un compte sur https://supabase.com et un nouveau projet (région Europe, plan Free).
2. Dans « SQL Editor », coller le contenu de `supabase/schema.sql` et lancer.
3. Dans Authentication, section Sign In / Providers :
   - laisser les inscriptions ouvertes (« Allow new users to sign up ») ;
   - activer le fournisseur Email, et désactiver « Confirm email » (l'envoi de mails gratuit est limité à 2 par heure) ;
   - mettre la longueur minimale du mot de passe à 10.
4. Dans Project Settings > API, récupérer l'URL du projet et la clé publique (`anon` / `publishable`) et les mettre dans `web/src/config.ts`.

Ces deux valeurs peuvent rester dans le code, elles sont faites pour ça. Par contre, ne jamais y mettre
la clé `service_role` ni le mot de passe de la base.

Un projet gratuit est mis en pause après 7 jours sans activité. Un clic sur « Restore » dans le tableau de bord le relance.

## Comment c'est protégé

Toutes les tables ont la sécurité par ligne activée. Chacun ne peut lire que ses propres données et celles des gens de son cercle
(profil, statut, photo, y compris pour les mises à jour en direct). Quelqu'un qui n'est pas connecté n'a accès à rien.

On entre dans un cercle avec un code d'invitation de 10 caractères (ou le lien / QR code qui va avec).
Au bout de 10 codes faux dans l'heure, c'est bloqué. Le code ne se voit que sur son propre compte et se change quand on veut.
Retirer un contact coupe le lien des deux côtés.

## Mise en ligne

Le fichier `.github/workflows/deploy.yml` construit l'app et la publie sur GitHub Pages à chaque envoi sur `main`.
Dans les réglages du dépôt, il faut mettre Pages > Source sur « GitHub Actions » (une seule fois).
