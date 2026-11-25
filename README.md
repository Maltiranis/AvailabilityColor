# Dispo – statut de disponibilité pour ton cercle de contacts

Chacun choisit son état (En ligne / Absent(e) / Occupé(e) / Hors ligne) + un texte optionnel.
Seuls les membres de son cercle le voient.

## Structure du projet
```
dispo-app/
  supabase/schema.sql   ← base de données + règles de sécurité (étape 1, fait)
  web/                  ← app web installable (PWA) (étape 2)
  windows/              ← widget + icône barre système (étape 3)
  android/              ← app + widget Android (étape 4)
```
Tout est du texte : tu édites avec VS Code (gratuit) ou le Bloc-notes.

## Étape 2 – L'app web (dossier `web/`)
Prérequis : Node.js (installé). Dans un terminal, dossier `web/` :
- `node node_modules/vite/bin/vite.js` → lance l'app sur http://localhost:5173 (rechargement automatique quand tu modifies un fichier)
- `node node_modules/vite/bin/vite.js build` → produit le dossier `dist/` à mettre en ligne
(Les commandes `npm run dev/build` ne marchent pas si le chemin du projet contient un `&`.)

Où modifier quoi : `src/app.ts` (écrans et logique), `src/style.css` (apparence), `src/supabase.ts` (états et couleurs),
`src/config.ts` (URL + clé publique du serveur).

## Étape 1 – Créer le serveur gratuit (≈ 5 min, sans carte bancaire)

1. Va sur https://supabase.com → **Start your project** → connecte-toi (GitHub ou e-mail).
2. **New project** : nom `dispo`, mot de passe de base de données (garde-le dans ton gestionnaire de mots de passe),
   région **Europe (Frankfurt ou Paris)**, plan **Free**.
3. Attends ~2 min que le projet démarre.
4. Menu **SQL Editor** → **New query** → colle tout le contenu de `supabase/schema.sql` → **Run**.
   Tu dois voir « Success. No rows returned ».
5. Menu **Authentication → Sign In / Providers → Email** :
   - garde **Enable email provider** activé ;
   - désactive **Confirm email** (l'envoi d'e-mails gratuit de Supabase est limité à 2 par heure,
     ce qui bloquerait les inscriptions) ;
   - mets **Minimum password length** à 10.
6. Menu **Project Settings → API** : note
   - **Project URL** (ex. `https://xxxx.supabase.co`)
   - **anon public key** (clé « publique »)

   Envoie-moi ces deux valeurs. Elles sont faites pour être visibles dans l'app : la sécurité vient
   des règles du `schema.sql`, pas du secret de cette clé.

## ⚠️ Ne jamais partager
- la clé **service_role** (donne tous les droits, ne doit jamais être dans l'app ni m'être envoyée) ;
- le mot de passe de la base de données.

## À savoir (offre gratuite)
- Un projet sans aucune activité pendant 7 jours est mis en pause ; un clic sur **Restore** le réveille.
- Limites : 500 Mo de base, 1 Go de photos, 50 000 utilisateurs actifs/mois : très large pour un usage de cercles privés.

## Comment la confidentialité est garantie
- Toutes les tables ont la sécurité par ligne (RLS) : un utilisateur ne peut lire que ses données
  et celles des gens dans son cercle, y compris pour le temps réel et les photos.
- Les visiteurs non connectés n'ont accès à rien.
- Les liens de contacts ne se créent que via un code d'invitation (10 caractères, 10 essais ratés max par heure)
  et ne se suppriment que via la fonction dédiée (coupe dans les deux sens).
- Ton code d'invitation n'est lisible que par toi ; tu peux le changer à tout moment.
