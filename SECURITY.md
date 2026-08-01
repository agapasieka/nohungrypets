# Security Policy

## Reporting a Vulnerability

If you find a security issue in NoHungryPets (e.g. a way to bypass Firestore rules, access another user's data, or abuse authentication), please report it privately rather than opening a public issue.

- **Preferred**: use [GitHub's private vulnerability reporting](https://github.com/agapasieka/nohungrypets/security/advisories/new)
- **Email**: info.nohungrypets@gmail.com

Please include steps to reproduce and the potential impact. We'll aim to acknowledge reports within a few days — this is a small, free, single-maintainer project, so response times may vary.

## Scope

This is a static frontend (GitHub Pages) backed by Firebase Auth and Firestore, with no server-side code. In-scope issues include:

- Firestore security rule bypasses
- Authentication/authorization flaws
- XSS or other client-side injection issues
- Exposed secrets or credentials that shouldn't be public

Out of scope: the Firebase Web API key visible in the client JS is expected and not sensitive by itself (see [Firebase's docs on API keys](https://firebase.google.com/docs/projects/api-keys)).
