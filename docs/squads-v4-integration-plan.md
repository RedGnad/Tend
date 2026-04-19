# Plan d'intégration Squads Protocol v4 — cashback live Tend

**Statut** : plan, avant code
**Source d'audit** : [audit-squads-v4-spending-limits.md](./audit-squads-v4-spending-limits.md)
**Date** : 2026-04-19
**Approche** : planification exhaustive avant exécution. Tout raccourci ou décision implicite doit remonter comme question ouverte avant d'être codé.

---

## 1. Objectif produit

Éliminer le custody risk sur les fonds des créateurs en remplaçant le flow actuel `creator → adminWallet Tend (hot wallet custody) → trader` par `creator → Squads vault (multisig) → trader`, où l'agent Tend ne peut que déclencher des `spending_limit_use` bornés par un `amount` quotidien et ne peut jamais retirer arbitrairement.

**Critère de succès end-to-end** :
1. Un créateur externe crée une campagne via `/creator`, signe les transactions Squads (create multisig ou attach à multisig existant + fund vault + add spending limit) sans aucune custody par Tend
2. L'agent détecte un swap qualifiant, appelle le fraud gate, puis exécute `spending_limit_use` vers le wallet du trader — le cashback arrive en < 10s après le swap
3. Le créateur peut à tout moment retirer ses fonds restants (via l'app Squads native ou via `/creator`) sans aucune intervention Tend
4. Si la clé agent est compromise, le blast radius est borné on-chain à `amount` par période par campagne — vérifié par test adversarial en devnet

---

## 2. Threat model consolidé

### 2.1 Acteurs
- **Créateur** : propriétaire du multisig / config_authority (peut attacher/détacher des SpendingLimits, withdraw fonds)
- **Agent Tend (backend)** : member du SpendingLimit uniquement, signe les `spending_limit_use`
- **Trader** : bénéficiaire d'un cashback, inconnu au moment de la création de la campagne
- **Attaquant type A** : exfiltre la clé agent (leak env var, supply chain npm, exploit serveur)
- **Attaquant type B** : compromet le frontend pour injecter une fausse UI de création de campagne
- **Attaquant type C** : contrôle un trader malveillant pour tromper le fraud gate et toucher des cashbacks illégitimes

### 2.2 Scénarios et garde-fous

| Scénario | Impact sans mitigation | Mitigation mise en place |
|---|---|---|
| Clé agent fuite (type A) | Attaquant signe `spending_limit_use` vers ses wallets | Blast radius borné : `amount - spent_in_period` par période. Reset quotidien. Agent peut sortir au max `amount` vers n'importe quelle adresse. `amount` configuré à budget journalier réaliste, pas à la taille totale du pool |
| Créateur malveillant | Peut retirer ses propres fonds — normal, c'est son pool | Pas de protection nécessaire. Les créateurs ne peuvent pas toucher aux pools des autres (multisig distinct) |
| UI frontend compromise (type B) | Attaquant fait signer au créateur une tx Squads vers un faux vault | Audit : vérifier que la signature Squads affiche bien l'adresse vault côté wallet Phantom/Solflare. Mitigation : publier un script CLI de vérification pour créateurs avancés |
| Trader farmer avec bots (type C) | Cashbacks illégitimes drainent le pool | Fraud gate Claude existant (inchangé). Plus le `amount` quotidien borné limite le damage agrégé |
| Upgrade malveillant du programme Squads | Patch qui change la logique `spending_limit_use` | **Impossible** — programme immutable vérifié on-chain |
| `ProgramConfig.multisig_creation_fee` relevé par l'authority Squads | Coût création campagne ↑ unilatéralement | Monitoring on-chain du field, alerte si modifié. Authority Squads pourrait le faire mais c'est un vote de confiance envers l'écosystème |
| Clé `config_authority` du multisig créateur fuite | Attaquant peut attacher un SpendingLimit malveillant | Les créateurs gardent le contrôle de leur clé. Tend documente : "ne pas partager la clé signataire du multisig avec Tend" |

### 2.3 Décisions découlant du threat model
- **Blast radius quotidien** doit être calibré à `budget réaliste d'1 jour de campagne`, pas à la taille totale. Par défaut : `min(pool_cap × 30%, 0.5 SOL)` — **à valider user**.
- **Rotation de la clé agent** : protocole documenté, déclenchable à tout moment. Implique un appel `spending_limit_remove_member` + `spending_limit_add_member` signé par le `config_authority` (donc le créateur). **Implication** : la rotation de la clé Tend n'est pas unilatérale — elle nécessite la co-signature du créateur. Friction acceptable.
- **Multi-agent deployment** (future) : si on veut plusieurs instances Tend avec des clés différentes, chacune est member du SpendingLimit. Scope v2.

---

## 3. Décisions architecturales à acter

Sept décisions qui engagent la structure. Chacune a un default, mais doit être validée.

### 3.1 Pattern multisig : 1 par créateur vs 1 par campagne vs 1 master Tend

| Option | Pour | Contre |
|---|---|---|
| **A. 1 multisig par campagne** | Isolation maximale, simple à raisonner, chaque créateur contrôle chaque vault indépendamment | Rent × N campagnes (0.82 SOL pour 100), setup friction à chaque création de campagne |
| **B. 1 multisig par créateur, N SpendingLimits via `vault_index`** (recommandé par l'audit) | Rent optimisé (0.004 + N × 0.004), 1 seul setup par créateur, ségrégation des fonds via `vault_index` distincts | Les fonds de toutes les campagnes d'un créateur sont dans un même multisig (mais séparés logiquement par SpendingLimit) |
| **C. 1 multisig master Tend contrôlé par Tend** | Friction zéro pour le créateur (pas de tx multisig_create à signer) | **Rejeté** — réintroduit la custody. Tend contrôlerait le multisig = même problème qu'aujourd'hui |

**Default recommandé : B** (1 multisig par créateur). Question ouverte : tu valides ?

### 3.2 Config authority du multisig créateur

Le `config_authority` d'un multisig Squads peut attacher des SpendingLimits sans passer par le flux propose/vote/execute. Critique pour l'UX.

| Option | Pour | Contre |
|---|---|---|
| **A. Créateur seul = config_authority** | Contrôle total du créateur, Tend ne peut rien attacher sans signature | À chaque nouvelle campagne du même créateur : nouvelle signature du créateur requise |
| **B. Créateur ET Tend co-config_authority (2-of-2)** | Tend peut attacher mais doit passer par proposal + créateur signe | Latence ajoutée, complexité UX |
| **C. Créateur + Tend en 1-of-2** | Tend peut attacher seul une SpendingLimit | **Rejeté** — re-custody : Tend pourrait attacher une SpendingLimit vers lui-même |

**Default recommandé : A** (créateur seul). La friction "re-signer pour chaque nouvelle campagne" est acceptable côté UX (rare en pratique, un créateur ne lance pas 10 campagnes par jour).

### 3.3 Clé agent Tend : globale vs par créateur

| Option | Pour | Contre |
|---|---|---|
| **A. Une seule clé agent partagée** | Simplicité ops, une seule clé à stocker | Leak = compromet toutes les campagnes simultanément (dans la limite des amounts quotidiens) |
| **B. Une clé agent dérivée par créateur** | Isolation : leak d'une clé ne compromet qu'un créateur | Complexité ops : N clés à stocker/rotate, KMS multi-keys |

**Default recommandé : A** au MVP, migration vers B si scale > 50 créateurs. Le blast radius est déjà borné par `amount` quotidien, une isolation supplémentaire est du defense-in-depth.

### 3.4 Stockage de la clé agent

| Option | Pour | Contre |
|---|---|---|
| **A. Env var chiffrée Render** | Zéro setup externe, déjà en place | Clé en plaintext dans le processus, surface attaque Render |
| **B. AWS KMS Ed25519 natif (dispo nov 2025)** | HSM-backed, audit trail AWS, rotation native | Setup AWS, coût KMS ($1/mois + par signature) |
| **C. Turnkey / Fireblocks** | Policy engine, rotation auto | Vendor-lock, coût élevé |

**Default recommandé : A au MVP** (accepté parce que blast radius borné), **migration B (AWS KMS)** en dur quand on passe en prod commerciale. Documenter explicitement comme dette technique dans `docs/`.

### 3.5 Formule `amount` (blast radius quotidien)

Default proposé : `amount = min(pool_cap × 30%, 0.5 SOL)`.

Raisonnement :
- 30% du pool = campagne s'épuise en ~3-4 jours si 100% du amount est consommé chaque jour → aligné avec campagnes courtes
- Cap absolu 0.5 SOL ≈ 75-100$ → si leak, damage max 0.5 SOL / jour par campagne, le temps que le monitoring détecte et que le créateur rotate
- Paramétrable par le créateur à la création (slider UI)

**Question ouverte** : 30% est-il le bon défaut ou tu veux 20% (plus conservateur) ou 50% (plus agressif pour flywheel) ?

### 3.6 Gestion du reset non-rolling

Squads reset `remaining_amount = amount` à l'expiration exacte de la période. Implication : un créateur peut voir un cashback passer juste avant minuit UTC, puis un autre juste après → 2× le amount en quelques minutes.

| Option | Pour | Contre |
|---|---|---|
| **A. Accepter le reset discret, documenter "budget reset à minuit UTC"** | Simple, pas de code applicatif à ajouter | Attaquant qui vole la clé peut exploiter le reset 2× en quelques minutes |
| **B. Enforce un rolling window applicatif côté agent** (tracker `last_payout_ts` + `spent_in_24h` côté agent) | Rate limit plus strict | Double vérification : si le code applicatif diverge de l'état on-chain, confusion |

**Default recommandé : A** (accepter le reset discret). Le risque 2× amount aux frontières de période est borné et détectable par monitoring. Simple > défensif complexe.

### 3.7 Migration des campagnes custody existantes

Combien de campagnes actives en custody actuellement ? Si < 5, one-shot. Si > 20, gradual.

**Question ouverte** : état actuel à vérifier via `~/.tend/state.json` ou DB.

Plan par défaut :
1. Freeze 48h des nouvelles créations sur l'ancien flow
2. Pour chaque campagne active : créer multisig + SpendingLimit, transférer fonds de `adminWallet` vers `vault` Squads, écrire le nouveau `vault_pubkey` dans la campagne
3. Updater l'UI pour pointer vers les vaults Squads
4. Anciennes campagnes terminées restent en custody mais sont marquées "legacy"

---

## 4. Phases de build avec checkpoints

### Phase 0 — Spike exploratoire (1 jour)

**Objectif** : valider que le SDK `@sqds/multisig` couvre bien tous nos flux avant d'investir en build.

Tâches :
1. Install `@sqds/multisig` dans un sandbox Node (hors monorepo pour ne pas polluer)
2. Créer un multisig test sur devnet avec 2 clés locales (sim créateur + agent)
3. Fund le vault avec 0.1 SOL devnet
4. Attacher un SpendingLimit avec `amount = 0.01 SOL`, `period = Day`, `destinations = []`, member = clé agent
5. Exécuter 3 `spending_limit_use` successifs vers 3 wallets devnet différents — valider que les trois passent
6. Exécuter un 4ème `spending_limit_use` qui dépasse `amount` — valider qu'il est rejeté on-chain
7. Mesurer le coût CU réel de `spending_limit_use` via `logMessages` / `unitsConsumed`
8. Documenter toute friction SDK non-anticipée dans une note `docs/squads-spike-notes.md`

**Checkpoint** : compte-rendu écrit (succès / frictions / coût CU réel). **Gate** : si des frictions majeures apparaissent, on re-discute avant Phase 1.

### Phase 1 — Client wrappers shared (2 jours)

Fichier : `packages/shared/src/squads-client.ts`

Exports prévus :
- `createMultisigForCreator(creator: PublicKey): Promise<{ multisigPda: PublicKey, tx: Transaction }>` — build une tx signée par le créateur
- `getMultisigForCreator(creator: PublicKey): Promise<PublicKey | null>` — résout l'adresse déterministe depuis la clé créateur
- `attachSpendingLimit(params: { multisig, creator, campaignId, amount, period, agentKey, vaultIndex })` — build une tx signée par `config_authority`
- `executeSpendingLimitUse(params: { spendingLimit, agentKeypair, recipient, amount })` — signée par l'agent, exécutable immédiatement
- `getSpendingLimitState(spendingLimit: PublicKey)` — retourne `remaining_amount`, `last_reset`, `amount`, `period`
- `getVaultBalance(vaultPda: PublicKey)` — lamports du vault
- `removeSpendingLimit(spendingLimit, creator)` — rotation / close

Tests unitaires minimum :
- Mock SDK, vérifier que les instructions buildées ont les bons accounts + discriminators
- Test d'intégration devnet : un flow end-to-end create → fund → attach → use → remove

**Checkpoint** : package builde + tests passent + exemples en devnet documentés.

### Phase 2 — Orchestrateur côté serveur (2-3 jours)

Fichiers :
- `packages/agent/src/squads-orchestrator.ts` — gère le cycle de vie Squads côté agent
- `packages/frontend/src/app/api/campaigns/create/route.ts` — refactor pour utiliser le flow Squads

Changements :
1. `/api/campaigns/create` retourne maintenant une tx **unsigned** à faire signer côté client, pas juste un deposit vers adminWallet :
   - Si le créateur n'a pas de multisig Tend existant : tx contient `multisig_create_v2` + `spending_limit_add` + `transfer to vault`
   - Si existant : uniquement `spending_limit_add` + `transfer to vault` sur le multisig connu
2. Stocker dans Drizzle (`campaigns` table) les nouveaux champs : `multisigPda`, `vaultPda`, `spendingLimitPda`, `vaultIndex`
3. Migration Drizzle : schema bump avec nullable fields (rétrocompat campagnes legacy custody)

**Checkpoint** : création d'une campagne en devnet via `/creator` UI fait apparaître le multisig + SpendingLimit on-chain, state Drizzle à jour.

### Phase 3 — Agent payout path (2 jours)

Fichiers :
- `packages/agent/src/cashback-agent.ts` (ou équivalent existant) — remplacer le `SystemProgram.transfer`

Changements :
1. Dans le flow cashback : après fraud gate approve, au lieu de `serviceWallet.signAndSend(transfer)`, construire `spending_limit_use` via `squads-client.executeSpendingLimitUse`
2. Retry + idempotency : si `spending_limit_use` échoue parce que `remaining_amount` insuffisant (par ex si une autre instance a déjà payé ce cycle), retry après reset ou abandonner avec status `deferred`
3. Fallback pour campagnes legacy custody : si `campaign.vaultPda === null`, utiliser l'ancien flow `SystemProgram.transfer` — cohabitation le temps de la migration
4. Logging : enregistrer dans `rewardPayouts` le nouveau champ `spendingLimitTxSig`

**Checkpoint** : cashback end-to-end sur campagne Squads en devnet, observable on-chain via Solscan, Drizzle state à jour, logs clairs.

### Phase 4 — Migration + monitoring (1 jour)

1. Script `packages/agent/src/migrate-custody-to-squads.ts` : itère les campagnes legacy, crée les multisigs + SpendingLimits, transfère les fonds
2. Monitoring `packages/agent/src/squads-monitor.ts` :
   - Poll `ProgramConfig.multisig_creation_fee` toutes les heures → alerte si modifié
   - Pour chaque SpendingLimit actif : vérifier `remaining_amount` > seuil avant d'accepter de nouvelles campagnes (si < seuil, créateur doit top-up ou attendre reset)
3. Ops doc : `docs/squads-ops-runbook.md` — procédures rotation clé agent, réponse incident fuite, etc.

**Checkpoint** : toutes les campagnes migrées, monitoring en place, runbook écrit.

### Phase 5 — Tests mainnet-beta + déploiement (1 jour)

1. Créer une campagne test sur mainnet avec 0.05 SOL de budget réel
2. Laisser l'agent traiter pendant 48h
3. Vérifier : blast radius respecté, reset quotidien fonctionne, logs propres
4. Si tout passe : ouverture à nouveaux créateurs

**Checkpoint** : campagne mainnet réelle sans incident pendant 48h.

### Total temps

| Phase | Jours |
|---|---|
| 0. Spike | 1 |
| 1. Client | 2 |
| 2. Orchestrateur | 2-3 |
| 3. Agent payout | 2 |
| 4. Migration + monitoring | 1 |
| 5. Tests mainnet | 1 |
| **Total** | **9-10 jours** |

Cohérent avec l'estimation de l'audit. Pas de compression.

---

## 5. Plan de test

### Devnet
- **Test flow nominal** : create multisig → attach SL → use × N jusqu'à `amount` → reject au (N+1)ème → wait 24h (ou mock Clock) → use réussit de nouveau
- **Test rotation clé** : remove member + add nouveau member + use avec l'ancienne clé → reject attendu
- **Test remove SpendingLimit** : créateur retire la délégation → use par agent → reject attendu
- **Test withdraw créateur** : créateur signe une tx multisig pour retirer tout le vault → success

### Mainnet
- **Test 48h live** : 1 campagne, 0.05 SOL budget, amount 0.01 SOL/jour, 5-10 cashbacks sur 48h
- **Observation** : logs Drizzle + Solscan + Helius webhooks

### Adversarial
- **Test simulation clé agent volée** : sur devnet, prendre la clé agent et tenter de drainer au-delà de `amount` → doit échouer. Documenter le blast radius réel observé.

---

## 6. Observabilité

### Events Squads à indexer
- `MultisigCreated` (via Helius webhook sur programme Squads + filtre sur config_authority = notre système)
- `SpendingLimitAdded` / `SpendingLimitRemoved`
- `SpendingLimitUsed` (cashback payé — crucial pour Drizzle sync)
- `VaultTransaction` (withdraw créateur)

### Helius webhooks
Programmer 1 webhook par environnement (devnet + mainnet) filtrant sur le `Program ID` Squads v4 + sur les multisigs dont `config_authority` est dans notre base.

### Alertes
- `multisig_creation_fee` change → alerte immédiate
- `SpendingLimit.remaining_amount` < 10% de `amount` pour une campagne active → alerte "campagne bientôt épuisée"
- Agent payout échoue 3 fois d'affilée → alerte ops
- Clé agent non utilisée pendant > 7 jours → possible leak silencieux à investiger

---

## 7. Risques résiduels et plan de réponse

| Risque | Probabilité | Impact | Réponse |
|---|---|---|---|
| Bug non découvert dans programme Squads immutable | Faible (audit 3×) | Élevé (pas de patch) | Diversifier : post-v1, considérer un deuxième rail (custom Anchor audité, ou Jito Merkle pour batch weekly) |
| Squads v5 déprécie v4 | Moyenne (12-24 mois) | Moyen | Migration planifiée en backlog, pas urgente |
| `multisig_creation_fee` relevé unilatéralement | Faible | Bas (on peut absorber ou répercuter) | Monitoring + communication transparente aux créateurs |
| Légal AGPL bloque scaling commercial | Incertain | Moyen si monétisation B2B | Valider avec avocat avant de signer un B2B. Consumer OK par défaut |
| Rotation de clé agent devient un cauchemar ops | Moyenne | Moyen | Documenter le runbook, automatiser la génération de tx à faire signer au créateur |

---

## 8. Questions ouvertes à valider avant Phase 0

Avant de lancer le spike, 4 décisions qui engagent l'architecture :

1. **Pattern multisig** : option B (1 multisig par créateur + N SpendingLimits via vault_index) — **tu valides** ?
2. **Config authority** : option A (créateur seul) — **tu valides** ?
3. **Clé agent storage** : option A (env var Render au MVP, migration KMS en prod) — **tu valides** ?
4. **Formule `amount` par défaut** : `min(pool_cap × 30%, 0.5 SOL)`, paramétrable — **tu valides le 30% ou tu préfères un autre ratio** ?

Les 3 autres décisions (3.3, 3.4, 3.6) ont des défauts que je prendrai sauf contre-indication de ta part.

---

## 9. Ce qui N'EST PAS dans ce plan (à scoper séparément)

- UX d'onboarding créateur premier signup Squads (la première signature `multisig_create` est nouvelle pour eux, doc + tooltip à prévoir)
- Intégration MCP pour que Claude puisse appeler Squads via l'agent (post-v1)
- Dashboard agent decisions log qui inclut les SpendingLimit state (peut être fait en parallèle)
- Audit légal AGPL (à faire avant monétisation B2B, pas avant le MVP)

---

## 10. Définition du "done" pour ce chantier

- [ ] Toutes les nouvelles campagnes passent par Squads, zéro custody
- [ ] Toutes les campagnes legacy custody ont migré ou sont expirées
- [ ] Runbook ops écrit et testé (rotation clé, incident fuite)
- [ ] Monitoring actif avec alertes fonctionnelles
- [ ] Test 48h mainnet sans incident
- [ ] CLAUDE.md updated avec le nouveau modèle de custody
- [ ] Landing `/creator` updated avec le nouveau trust argument ("funds held in Squads vault you control")
- [ ] DORAHACKS / submission doc updated avec architecture smart contract

---

## Annexes
- [Audit adversarial](./audit-squads-v4-spending-limits.md)
- [Squads v4 repo](https://github.com/Squads-Protocol/v4) @ `edbca83` (2026-04-15)
- [@sqds/multisig SDK](https://github.com/Squads-Protocol/v4/tree/main/sdk/multisig)
- Program ID mainnet : `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
