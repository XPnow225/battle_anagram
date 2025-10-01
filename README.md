# Battle Anagram LIVE

Outil complet pour animer un duel d'anagrammes sur TikTok LIVE avec deux modes d'exécution : **test** (simulateur local) et **prod** (connexion directe à votre salon avec les vrais messages et cadeaux).

## 1. Pré-requis

- Node.js 18+ (pour la prise en charge du fetch natif et de la syntaxe récente)
- Compte TikTok autorisé à diffuser en direct
- Identifiants de session TikTok (non obligatoires si votre live est public, mais recommandés pour des connexions stables)

Après avoir cloné le projet, installez les dépendances :

```bash
npm install
```

## 2. Lancer le serveur

### Mode test (simulateur local)

Ce mode n'utilise pas TikTok : toutes les interactions se font via le panneau de contrôle.

```bash
npm run start:test
```

### Mode production (connexion TikTok)

Définissez au préalable les variables d'environnement suivantes :

- `TIKTOK_USERNAME` : votre @ TikTok (sans le `@`).
- `TIKTOK_SESSION_ID` : (optionnel) cookie de session TikTok valide, recommandé pour les lives privés ou protégés.
- `PORT` : (optionnel) port HTTP à exposer, `5173` par défaut.

Puis lancez :

```bash
npm run start:prod
```

Les deux interfaces sont alors disponibles :

- Overlay à intégrer dans OBS/Streamlabs : `http://localhost:5173/overlay.html`
- Console de contrôle (à garder hors stream) : `http://localhost:5173/control.html`

## 3. Fonctionnement général

### Commandes des viewers

- `+join` : inscription dans la file d'attente (prioritaire si cadeau reçu dans la même minute).
- `+pret` : le joueur déjà en place confirme sa participation ; sans confirmation sous 60 s, il est expulsé.
- Réponse au mot : seuls les deux joueurs actifs peuvent taper le mot complet. Le premier à réussir gagne **+30 s** et enlève **20 s** à son adversaire (valeurs ajustables).

### Gestion des cadeaux

Chaque cadeau (diamants, donuts, etc.) provoque :

- Remerciement vocal automatique.
- Priorité immédiate dans la file d'attente si le viewer n'est pas déjà en jeu.

### Mur des champions

- 4 victoires consécutives minimum pour entrer sur le mur.
- Une fois champion, il faut faire **streak + 1** pour le détrôner.
- Fin de chaque manche : annonce vocale du champion actuel avec défi « Qui pourra le détrôner ? ».

### Bannière & personnalisation

- Couleurs, police, format (16:9 ou 9:16) et temps sont paramétrables depuis la console.
- Bannière défilante pour rappeler les règles ou afficher des sponsors.
- Fond de l'overlay totalement personnalisable (couleur ou image via OBS).

## 4. Gestion des mots

1. Préparez un fichier `.txt` contenant un mot par ligne.
2. Dans la console, section « Gestion des mots » :
   - soit importez le fichier,
   - soit collez directement les mots dans la zone prévue.
3. Les mots sont immédiatement envoyés au serveur et utilisés pour les prochaines manches.

> Astuce : vous pouvez recharger la liste à tout moment, même pendant une partie (le mot courant reste inchangé).

## 5. Outils pour le mode test

La section « Mode test » de la console permet de :

- Simuler des messages (`+join`, `+pret`, réponse au mot, etc.).
- Simuler des cadeaux avec un montant et un intitulé.
- Forcer une victoire, marquer un joueur prêt ou l'expulser pour vérifier tous les scénarios.

## 6. Architecture technique

- **Serveur Node.js** (`server/index.js`) : Express + WebSocket pour diffuser l'état du jeu et recevoir les commandes du panneau.
- **Logique métier** (`server/logic/game-engine.js`) : gestion de la file, des timers, des scores, du mur des champions et de la synthèse vocale.
- **Passerelle TikTok** (`server/tiktok-bridge.js`) : encapsule `tiktok-live-connector` et diffuse les événements `chat` / `gift`.
- **Overlay** (`public/overlay.html`) : interface 16:9 ou 9:16 prête à être capturée dans OBS, voix via Web Speech API.
- **Console** (`public/control.html`) : panneau d'administration complet (options hors stream).

Toutes les communications se font en WebSocket pour assurer une latence minimale entre TikTok, la console et l'overlay.

## 7. Déploiement & sécurité

- Placez le serveur derrière un proxy HTTPS (nginx, caddy, etc.) si vous diffusez depuis une autre machine que votre PC de stream.
- Gardez le panneau de contrôle protégé (VPN, mot de passe proxy, etc.) car il permet de manipuler directement la partie.
- Ne partagez jamais votre `TIKTOK_SESSION_ID`.

## 8. Dépannage rapide

- **La voix ne parle pas** : vérifier que le navigateur autorise la synthèse vocale (Chrome/Edge recommandés). Sur OBS Browser Source, activez « Control audio via OBS ».
- **Pas d'événements en prod** : assurez-vous que le compte diffuse bien en direct et que l'identifiant TikTok est correct. Les comptes privés nécessitent la session ID.
- **Priorité file d'attente** : un cadeau repositionne le viewer en tête tant que sa priorité est active (timestamp). Les dons identiques successifs rafraîchissent la priorité.
- **Synchronisation** : si l'overlay semble figé, rechargez la page (WebSocket se reconnecte automatiquement).

Bon live ! 🎉
