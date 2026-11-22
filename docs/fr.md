# Leantime

Les tâches de votre [Leantime](https://leantime.io) auto-hébergé dans Gladys :
les ouvertes, celles du jour, celles en retard, celles terminées aujourd'hui et
le prochain jalon, pour toute l'instance et pour les projets de votre choix.
Une scène réagit quand une tâche est assignée à quelqu'un ou passe en retard,
une autre crée « vérifier les détecteurs de fumée » chaque mois, et Gladys peut
lire les tâches du jour chaque matin.

> **Vos retours sont bienvenus.** Cette intégration a été testée contre un vrai
> serveur Leantime (image Docker `leantime/leantime` 3.15.3 avec MariaDB 11,
> novembre 2026), pas encore à l'usage quotidien. Si quelque chose ne marche pas
> comme décrit, dites-le sur le [forum Gladys](https://community.gladysassistant.com)
> ou dans les [issues](https://github.com/guim31/gladys-leantime/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un **Leantime 3.x** que Gladys peut joindre sur votre réseau.
- Une **clé d'API** de Leantime : dans Leantime, **Paramètres de l'entreprise**
  → onglet **Clé d'API** → générer une clé (un administrateur peut le faire).
  Donnez-lui le rôle **Éditeur** (« Rédacteur en chef » dans Leantime en
  français), pour qu'elle puisse créer des tâches, et les projets à suivre.
  Copiez la clé (`lt_…`) : Leantime ne la montre qu'une fois.

La clé d'API agit comme un utilisateur à part entière : l'intégration voit les
projets attribués à la clé (une clé administrateur les voit tous), et les
tâches créées depuis Gladys portent son nom.

## Mise en place

1. Dans Gladys, **Intégrations** → installez **Leantime**.
2. Sur l'écran **Configuration**, remplissez :
   - **Adresse** : l'adresse de Leantime comme dans le navigateur, par exemple
     `http://192.168.1.20:8080`, ou `https://pm.example.org` derrière un
     reverse proxy (un préfixe comme `/leantime` est conservé) ;
   - **Clé d'API**.
3. Options :
   - **Projets suivis** : noms ou numéros (le numéro figure dans l'adresse du
     projet) séparés par des virgules, 20 au plus. Chacun a son appareil, en
     plus de celui de toute l'instance. Vide : l'appareil de l'instance seul ;
   - **Accepter les certificats auto-signés** : pour une adresse en `https://`
     au certificat auto-signé, sur votre propre serveur seulement ;
   - **Intervalle de rafraîchissement** : 1 à 10 minutes (5 par défaut).
     Minuit est toujours suivi à l'heure, quel que soit l'intervalle ;
   - **Langue des noms de fonctionnalités** : les noms donnés aux
     fonctionnalités à l'ajout d'un appareil (français par défaut), et les
     textes envoyés aux scènes.
4. Enregistrez, puis **Tester la connexion** : elle lit Leantime et indique le
   nombre de tâches ouvertes, de projets et de projets suivis.
5. Dans l'onglet **Découverte**, ajoutez les appareils voulus.

## Appareils

**Leantime**, pour toute l'instance (tous les projets que voit la clé), et
**Leantime _projet_** pour chaque projet suivi, avec ces fonctionnalités :

| Fonctionnalité           | Ce qu'elle montre                                                               |
| ------------------------ | ------------------------------------------------------------------------------- |
| `Tâches ouvertes`        | les tâches dont le statut n'est pas de type « Terminé »                         |
| `À échéance aujourd'hui` | les tâches ouvertes dont l'échéance est aujourd'hui                             |
| `En retard`              | les tâches ouvertes dont l'échéance est passée                                  |
| `Terminées aujourd'hui`  | les tâches d'un statut « Terminé » modifiées pour la dernière fois ce jour      |
| `Prochain jalon`         | le jalon ouvert qui se termine le plus tôt, aujourd'hui compris ; `Aucun` sinon |

Une **tâche** est tout ticket qui n'est pas un jalon (tâche, bug, story,
sous-tâche). Elle est **ouverte** tant que son statut n'est pas de type
« Terminé » dans son projet (`Done` et `Archived` par défaut). Son jour
d'échéance est sa **date d'échéance** ; celui d'un jalon, sa date de fin.
« Aujourd'hui » est le jour dans le fuseau de Gladys. Leantime ne garde pas de
date de clôture : « Terminées aujourd'hui » compte les tâches terminées
modifiées ce jour, donc aussi une tâche finie plus tôt et retouchée aujourd'hui.

## Tableau de bord

Le widget **Tâches du jour** montre deux tuiles (aujourd'hui, en retard) et la
liste des tâches à finir ce soir (10 au plus), celles en retard d'abord avec
leur date, puis celles du jour, avec leur projet. Choisissez un appareil projet
dans les réglages du widget pour ne voir que ses tâches, et un nom dans
**Seulement les tâches de** pour ne voir que celles d'une personne. Quand rien
n'est dû, le widget le dit et donne le prochain jalon, sauf si **Afficher le prochain jalon quand rien
n'est dû** est décoché. Les projets portent le
nom donné dans Gladys une fois leur appareil ajouté.

Les compteurs peuvent aussi aller sur le tableau de bord comme toute
fonctionnalité d'appareil.

## Scènes

### Déclencheurs

- **Tâche Leantime assignée** : une tâche ouverte est désormais assignée à
  quelqu'un : elle vient d'être assignée ou réassignée, créée avec un assigné,
  ou rouverte.
- **Tâche Leantime en retard** : à minuit, une tâche due ce jour-là est
  toujours ouverte. Une fois par tâche et par échéance.

Filtres : le projet (un appareil projet, pas celui de l'instance) et, pour le
premier, l'**assigné** : son prénom et son nom exactement comme Leantime les
affiche (`Camille Martin`). Données transmises aux actions : la tâche, son
numéro, son projet, son type, son statut, l'assigné, son échéance
(`AAAA-MM-JJ`) et son adresse dans Leantime.

Un changement est vu à la lecture suivante : dans l'intervalle de
rafraîchissement. Une échéance déplacée à la main sur un jour déjà passé ne
déclenche rien. Un redémarrage ne déclenche rien deux fois ; une tâche assignée
pendant l'arrêt de l'intégration déclenche à son redémarrage, de même qu'un
minuit passé depuis moins d'une heure.

### Actions

- **Créer une tâche Leantime** : un titre ; le projet par son nom ou son numéro
  (vide : le premier projet suivi) ; une **échéance** facultative :
  `2026-11-24`, ou `+3d` pour dans trois jours ; une description facultative.
  La tâche est créée sans assigné, au statut `New`. Résultats : la tâche, son
  numéro, son adresse, son projet, son échéance.
- **Lire les tâches Leantime du jour** : les tâches à finir ce soir en une
  phrase (`3 tâche(s) à finir ce soir : …. 1 en retard.`), pour toute
  l'instance ou un projet, et pour tout le monde ou un assigné. Résultats : la
  phrase, le nombre de tâches à finir ce soir, celui des tâches en retard.
  Envoyez la phrase dans un message, ou faites-la dire à Gladys.

Un échec (projet inconnu, date incomprise, clé sans le droit) s'affiche en
rouge avec sa raison. Les champs acceptent les variables de scène, par exemple
`{{triggerEvent.data.task}}`.

### Idées de scènes

- À 8 h, **Lire les tâches Leantime du jour** de `Camille Martin`, puis envoyer
  la phrase sur Telegram.
- **Tâche Leantime assignée** à `Camille Martin` : envoyer la tâche et son
  adresse dans un message.
- **Tâche Leantime en retard** dans le projet `Maison` : passer la lampe de
  rappel en orange.
- Le premier du mois, **Créer une tâche Leantime** `Vérifier les détecteurs de
fumée` dans `Maison`, échéance `+7d`.

## Dépannage

- **« Leantime ne répond pas »** : vérifiez l'adresse et le port depuis la
  machine de Gladys (l'adresse ouvre Leantime dans un navigateur).
- **« Clé d'API refusée »** : la clé est mal recopiée (elle commence par `lt_`)
  ou supprimée : générez-en une nouvelle.
- **« Aucune API de Leantime à cette adresse »** : l'adresse répond, mais pas
  avec l'API de Leantime : vérifiez le port et le préfixe. Après une mise à
  jour de Leantime, ouvrez-le une fois dans un navigateur en administrateur :
  il attend peut-être la mise à jour de sa base.
- **« L'adresse redirige »** : saisissez l'adresse en `https://`.
- **« La clé d'API n'a pas ce droit »** : donnez-lui le rôle Éditeur, et le
  projet.
- **« Ce Leantime est trop ancien »** : la version 3.x est nécessaire.
- **Un projet manque** : attribuez-le à la clé dans Leantime ; un nom saisi
  dans **Projets suivis** qui ne correspond à aucun projet est ignoré, et
  **Tester la connexion** le signale. Les projets clos sont écartés.
- **« Plusieurs projets portent ce nom »** : indiquez son numéro.
- Logs : `LOG_LEVEL=debug` sur le conteneur montre chaque lecture.

## Limites

- Leantime est lu toutes les 1 à 10 minutes (et à minuit) : un changement dans
  Leantime apparaît dans Gladys dans ce délai. Chaque lecture fait trois
  requêtes (projets, tickets ouverts, tickets terminés du jour), plus une par
  projet pour ses statuts une fois par heure. Leantime 3.7 et suivants filtrent
  les tickets sur le serveur ; un 3.x plus ancien renvoie tous les tickets, que
  l'intégration trie elle-même.
- L'intégration crée des tâches ; elle ne les modifie, ne les clôt, ne les
  assigne ni ne les supprime, et ne lit ni leurs commentaires, ni leurs
  fichiers, ni le temps passé. L'assigné d'une tâche créée depuis Gladys se
  choisit dans Leantime.
- La clé d'API est gardée par Gladys dans la configuration de l'intégration et
  envoyée seulement à l'adresse configurée. Gladys ne garde aucune donnée de
  Leantime hors de `/data/leantime-state.json` (l'heure de la dernière lecture
  et le numéro de l'assigné de chaque tâche ouverte, pour qu'aucun événement ne
  parte deux fois).
- Sans lien avec Leantime ni son éditeur. Leantime est une marque de son
  propriétaire.
