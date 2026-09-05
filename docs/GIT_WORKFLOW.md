# GIT_WORKFLOW.md — DealFlow360

The hackathon grades this: *"Use version control (Git) properly; one member managing the repo is not enough."*
Both developers must have real, substantial commit history. This file is the protocol.

---

## 0. One-time setup

### Dev A (Pratham) — create and push

1. Go to **https://github.com/new**
2. Repository name: `dealflow360`
3. **Public** — judges may want to look at it
4. **Do not** tick "Add a README", "Add .gitignore", or "Choose a license" — the repo already has files, and an initialised remote forces an awkward merge

Then, from `D:\Dealflow`:

```bash
git commit -m "docs: phase 0-2 decision, requirements, architecture, schema"
```

```bash
git remote add origin https://github.com/<your-username>/dealflow360.git
```

```bash
git push -u origin main
```

### Add the teammate

GitHub → repo → **Settings → Collaborators → Add people** → their username → they accept the emailed invite.

### Dev B — clone and set identity

**This is the step that makes the grading criterion pass.** Do it before the first commit, not after:

```bash
git config --global user.name "Their Real Name"
```

```bash
git config --global user.email "their-github-email@example.com"
```

The email must be one attached to their GitHub account, or commits won't link to their profile and the contribution graph stays empty.

```bash
git clone https://github.com/<your-username>/dealflow360.git
```

Verify before doing anything else:

```bash
git config user.name && git config user.email
```

---

## 1. Branch protocol

`main` always runs. Nobody pushes to it directly.

One branch per vertical slice, named for the slice:

```bash
git checkout -b slice/03-quotation-builder
```

Work → commit → push → merge into `main` → both pull. **Merge at every slice boundary, not at the end.** Two people and one merge at 04:00 is how integration nights are lost.

```bash
git push -u origin slice/03-quotation-builder
```

Merging (fast, no PR ceremony — we don't have time for review rounds, and merging your own slice is fine here):

```bash
git checkout main && git pull && git merge slice/03-quotation-builder && git push
```

Then the other dev immediately runs:

```bash
git checkout main && git pull
```

---

## 2. Commit conventions

`type(scope): imperative summary`

Types: `feat` · `fix` · `docs` · `test` · `refactor` · `chore`

```
feat(risk): blended score with worst-line override
feat(portal): session-scoped quotation endpoint
fix(stock): lock rows in deterministic order to avoid deadlock
test(billing): proration on mid-cycle quantity change
docs(ai): explainability write-up for upsell ranking
```

**Commit often — every 20–40 minutes of real work.** Two reasons, both practical:

1. A judge scanning `git log` sees genuine incremental development, not three giant dumps.
2. When something breaks at 03:00, small commits mean `git diff HEAD~1` actually tells you what changed.

Never commit `.env`, `node_modules/`, or `dist/` — `.gitignore` covers them, but check `git status` before staging.

---

## 3. Avoiding conflicts — the work split

The architecture is designed so two people rarely touch the same file. Keep it that way.

| | **Dev A** | **Dev B** |
|---|---|---|
| Owns | `server/services/` · `db/migrations/` · `server/repositories/` | `web/src/` · `portal/src/` · `server/routes/` |
| Domain | risk scoring, approvals, fulfillment, billing | screens, shells, components, portal SPA |

**Shared files — coordinate before editing:**

- `shared/types.ts` — the API contract. Whoever needs a new shape adds it and pushes **immediately**, then tells the other person. Don't sit on a type change.
- `db/migrations/*.sql` — never edit an already-pushed migration. Add a new numbered file instead. Editing a shipped migration means the other dev's database silently diverges from yours.
- `tailwind.config.js` — tokens are settled in `design.md`. Changing them mid-build breaks screens the other person already built.

**If you both need the same file:** the one who needs it *less* waits. Coordinating for thirty seconds beats resolving a merge conflict in business logic at 3 AM.

---

## 4. Resolving a conflict

```bash
git pull --no-rebase
```

Git marks conflicts with `<<<<<<<` / `=======` / `>>>>>>>`. Open the file, keep the correct version, **delete all three markers**, then:

```bash
git add . && git commit && git push
```

If a merge goes badly wrong and you want out before it lands:

```bash
git merge --abort
```

That returns you to the state before the merge. Nothing is lost.

---

## 5. What "used Git properly" looks like at 10:00 AM

A judge who opens the repo should see:

- **Two contributors with comparable commit counts** — not 95/5
- 40+ commits, spread across the night, not three at the end
- Descriptive messages that trace the build: auth → schema → risk engine → approvals → portal
- Branch history showing parallel work that was merged, not one linear branch
- `main` in a runnable state, `.env` absent, `node_modules` absent
- A README a stranger can follow to run the project cold

Check your standing at any point:

```bash
git shortlog -sn
```

If that output is lopsided by more than roughly 70/30, rebalance who takes the next slices. It is a graded criterion, and it is far easier to fix at 02:00 than at 09:00.
