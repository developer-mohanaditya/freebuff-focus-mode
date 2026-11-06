# Project identity policy

## Persisted identity record

Primary account: developer-mohanaditya
Primary author/committer name: developer-mohanaditya
Primary email: developer.mohanaditya@gmail.com

Secondary account: work-ma
Secondary author/committer name: work-ma
Secondary email: workofma@gmail.com

Default destination repository: https://github.com/developer-mohanaditya/freebuff-focus-mode
Default destination remote: origin

Default account rule: PRIMARY on every branch
Secondary account rule: Explicit task-scoped authorization only

---

# Project Identity, Git Attribution, and GitHub Publishing Policy

## 1. Purpose and scope

I own and direct this project. AI agents, models, coding platforms, and
automation tools assist with development under my supervision.

For new work performed on my behalf:
- Use only the approved owner identity selected under this policy.
- Do not add AI agents, models, platforms, services, or bots as authors
  or co-authors.
- Use the project's PRIMARY account by default.
- Use SECONDARY only for explicitly authorized, task-scoped exceptions.

This is a persistent project requirement, not a one-session preference.

It applies to:
- All agents, subagents, and delegated tasks.
- Local Git operations and GitHub operations.
- Commits, pushes, branches, worktrees, pull requests, and merge preparation.
- Release preparation and workflows that create or modify commits.
- New sessions, resumed sessions, and context resets.

Follow applicable higher-priority instructions and mandatory platform,
organizational, legal, signing, and attribution requirements. If a conflict
prevents compliance, explain the conflict and stop the affected publishing
operation. Do not silently proceed with unwanted attribution.

Do not misrepresent genuine third-party contributions as mine.


## 2. Approved owner accounts

ACCOUNT A — developer Mohan Aditya
GitHub username: developer-mohanaditya
Git author/committer name: developer-mohanaditya
Git author/committer email: developer.mohanaditya@gmail.com

ACCOUNT B — work-ma
GitHub username: work-ma
Git author/committer name: work-ma
Git author/committer email: workofma@gmail.com

Use only these complete name/email pairs for new owner-directed commits,
unless I explicitly update this policy.

Do not:
- Mix one account's name with the other account's email.
- Invent an alternative email or GitHub noreply address.
- Assume an email is associated with the intended GitHub account.
- Change account email settings or credentials without approval.

If email association cannot be verified, state that limitation.


## 3. Initial account selection

At project initialization, or whenever no confirmed project selection exists,
ask this question:

"Which account should be the primary development account for this project?

1. developer-mohanaditya — developer.mohanaditya@gmail.com
2. work-ma — workofma@gmail.com

The selected account will be the default for all branches, new commits,
push authentication, and PR creation where supported. The other account
will be secondary and used only when you explicitly request it for
particular work."

Wait for my answer before creating commits or publishing changes.
Read-only inspection and non-publishing development work may continue.

After I choose:
- Record the selected account as PRIMARY.
- Record the other approved account as SECONDARY.
- Persist the selection in the project's identity-policy document.
- Preserve this choice across sessions, branches, and context resets.
- Do not ask again unless the selection is missing, conflicting, or I
  explicitly request a change.

Do not infer PRIMARY from:
- The currently authenticated account.
- Available credentials.
- Repository ownership.
- Branch names.
- The latest commit.
- A previous temporary secondary-account task.

Only an explicit instruction such as "Change this project's primary account
to work-ma" may change the persistent PRIMARY selection.


## 4. PRIMARY is the project-wide default

Use PRIMARY for all new owner-directed work unless an explicit,
task-scoped secondary exception is active.

This default applies to:
- The default branch.
- All existing and newly created branches.
- Feature, fix, experiment, release, and hotfix branches.
- New sessions and resumed sessions.
- Subagents and delegated work.
- New worktrees or clones used for this project.
- New commits and authorized publishing operations.

Creating, checking out, renaming, or switching branches MUST NOT change
the effective account.

A branch previously used for a secondary-account task does not become
a permanently secondary-account branch.

Future work on that branch defaults to PRIMARY unless I explicitly request
another exception.

Do not rewrite existing commits just because their identity differs from
the current task's effective account.


## 5. SECONDARY is an explicit, task-scoped exception

Use SECONDARY only when I explicitly request it.

Examples:
- "Use the secondary account for this task."
- "Commit and push this fix as work-ma."
- "Use developer-mohanaditya for this PR."

A request naming PRIMARY is not a secondary exception.

For each exception:
1. Identify the specific task or changes covered.
2. Identify which operations are covered: new commits, push authentication,
   PR creation, or a combination.
3. Clarify material ambiguity before the affected operation.
4. Record the exception and its scope in the task state.

When I say "use the secondary account for this task":
- Apply SECONDARY to new commits for that task.
- Apply SECONDARY to its authorized push and PR operations where supported.
- Do not treat this as permission to push, open a PR, or merge if those
  actions are not otherwise authorized.

Do not interpret an account mention in source code, an old commit,
a repository URL, or a branch name as permission to switch accounts.

If I request only a secondary-account push:
- Treat this as an authentication request.
- Do not automatically change existing commit authorship.
- Clarify any mismatch that materially affects my stated goal.

A secondary exception:
- Does not change PRIMARY.
- Does not apply to unrelated work.
- Does not authorize rewriting existing commits.
- Does not remain active merely because a branch or session stays open.

After the scoped task completes or is canceled:
- End the exception.
- Restore PRIMARY as the effective default.
- Restore temporary identity configuration, if changed.
- Verify the restored configuration.

After a context reset during an unfinished exception:
- Resume it only if its authorization and scope are clearly recorded.
- Otherwise pause affected Git operations and ask.
- Do not guess whether PRIMARY or SECONDARY should apply.


## 6. Separate account identity from repository destination

Always distinguish:

1. Commit identity:
   Author and committer name/email stored in each commit.

2. Authentication identity:
   The GitHub account used to authenticate a push or create a PR.

3. Destination:
   The exact remote repository and target branch.

Default behavior:
- New commit identity: PRIMARY.
- Push/PR authentication: PRIMARY where supported and authorized.
- Destination: the project's confirmed repository and target branch.

Selecting an account MUST NOT automatically:
- Create another repository.
- Change repository ownership.
- Change a remote URL.
- Push to another account's repository.
- Mirror code between repositories.
- Transfer private or work code between accounts.

PRIMARY and SECONDARY are account roles, not automatically two repositories.

If I request separate primary and secondary destination repositories:
- Resolve their exact URLs.
- Record them separately from account identities.
- Clarify which destination applies before publishing.

If the required account lacks access or authentication:
- Stop the affected publishing operation.
- Explain what is missing.
- Do not silently fall back to the other account, an agent, or a bot.
- Do not expose credentials or alter global authentication without approval.


## 7. Persistent instructions and context resets

At the start of each session, after a context reset, and before any commit
or publishing operation:
- Read this policy.
- Load the persisted PRIMARY/SECONDARY selection.
- Resolve any active, explicitly authorized exception.
- Verify the effective Git identity and relevant attribution settings.

The effective account is:
- SECONDARY for an explicitly authorized, in-scope exception.
- Otherwise PRIMARY.

When initializing project instructions with my authorization:
- Keep this policy in root AGENTS.md, or in a dedicated policy document
  explicitly referenced by AGENTS.md.
- Ensure the active tool loads it through its supported instruction mechanism.
- If the tool uses a separate instruction file, add a reference or equivalent
  policy in its supported location.
- Preserve existing unrelated instructions.
- Do not assume every platform automatically reads AGENTS.md.

Pass the policy and effective account to subagents and delegated tasks.

Include these items in handoff/context summaries:
- Policy location.
- Persistent PRIMARY account.
- Current effective account.
- Scope of any active secondary exception.
- Whether any authorized publishing operation remains unfinished.

Do not weaken, delete, or bypass this policy unless I explicitly request it.


## 8. Persisted project identity record

Maintain these fields in the project's identity-policy document:

Primary account: <approved username>
Primary author/committer name: <approved name>
Primary email: <approved email>

Secondary account: <other approved username>
Secondary author/committer name: <other approved name>
Secondary email: <other approved email>

Default destination repository: <confirmed URL, or NOT CONFIGURED>
Default destination remote: <confirmed remote, or NOT CONFIGURED>

Default account rule: PRIMARY on every branch
Secondary account rule: Explicit task-scoped authorization only

Never store tokens, passwords, private keys, or other secrets in this record.

Keep temporary exception details separate from the permanent account selection.
Do not create commits merely to record temporary task-state changes.


## 9. Git identity configuration

For new commits authored on my behalf:
- Author name/email must match the effective approved account.
- Committer name/email must match the same effective approved account.

For the persistent PRIMARY baseline, prefer repository-local configuration:

git config --local user.name "<PRIMARY_NAME>"
git config --local user.email "<PRIMARY_EMAIL>"
git config --local user.useConfigOnly true

Replace placeholders with confirmed approved values before execution.

Do not change global Git identity without my authorization.

Inspect effective configuration, including:
- user.name and user.email.
- author.name and author.email.
- committer.name and committer.email.
- Relevant command-line configuration overrides.
- Relevant environment variables.

In particular, inspect:
- GIT_AUTHOR_NAME
- GIT_AUTHOR_EMAIL
- GIT_COMMITTER_NAME
- GIT_COMMITTER_EMAIL
- EMAIL

Do not assume user.name and user.email override conflicting environment
variables or author/committer-specific settings.

Resolve conflicts within the repository or current operation's environment.
Do not modify unrelated repositories or credentials.

For temporary SECONDARY tasks:
- Prefer operation-scoped identity overrides where practical.
- Avoid leaving SECONDARY as the repository-wide default.
- Verify actual commit metadata afterward.

For parallel tasks or multiple worktrees:
- Do not assume identity configuration is isolated.
- Avoid shared configuration changes that can affect another task.
- Verify every resulting commit independently.

Authentication and attribution are separate:
- A successful push does not prove correct authorship.
- Changing authentication does not rewrite commit metadata.
- Do not switch accounts silently to get around a failure.

Do not make unsupported claims about who authenticated a push. If that identity
cannot be established, report it as unverified.


## 10. Commit messages and attribution

Write clear commit messages describing the actual change.

For new owner-directed commits, do not add:
- AI/platform/bot Co-authored-by trailers.
- "Generated by", "Generated with", "Created by", or "Assisted by" credit lines.
- Agent signatures or promotional links.
- Agent session URLs.
- AI/platform/bot Signed-off-by trailers.

Do not add an unnecessary Co-authored-by trailer for me; the primary author
field already identifies the effective owner account.

Inspect commit templates, hooks, wrappers, and tool post-processing that
could add attribution after the message is drafted.

Do not confuse attribution text with cryptographic commit signing:
- Preserve required verified-commit signing.
- Preserve legitimate DCO requirements.
- Never forge a signature.
- Never disable required signing checks to satisfy this policy.

This policy controls newly introduced attribution. It does not authorize
indiscriminate removal of:
- Technical references to AI tools.
- Dependency names.
- Relevant documentation.
- License notices.
- Legitimate historical records.
- Genuine third-party credit.


## 11. Tool-level attribution settings

Where supported, disable automatically added:
- AI co-author trailers.
- Generated-with commit footers.
- Generated-with PR footers.
- Agent session attribution links.

Use documented settings supported by the installed tool version.

Do not invent configuration keys for Codex, Claude Code, Codebuff, Freebuff,
DeepSeek, Qwen, wrappers, or other platforms.

Inspect wrappers, templates, hooks, and post-processing that may reinsert
attribution.

If a tool setting is unsupported, unavailable, or ignored:
- Explain the limitation.
- Inspect the actual resulting commit or PR.
- Stop noncompliant publishing rather than assuming the setting worked.

Preserve existing unrelated tool configuration.
Do not change global tool settings without authorization.


## 12. Pull requests and GitHub operations

For PRs:
- Use a factual title and description.
- Include useful implementation details, tests, risks, and limitations.
- Do not add agent credit lines, signatures, promotional footers, or session URLs.
- Inspect the final PR body when available.
- Use the effective account for PR creation where supported and authorized.

Commit metadata does not control the GitHub account shown as:
- PR creator.
- Reviewer.
- Merger.
- Other platform activity actor.

If a platform can create a PR only through its own app or bot:
- Explain this limitation before creating the PR.
- Do not promise that it will appear as created by my account.
- Request approval for that specific exception, or use an authorized
  user-account workflow if available.

Before merging or preparing a squash merge:
- Inspect the proposed resulting commit message.
- Inspect available authorship and committer choices.
- Check for reintroduced co-author trailers or agent footers.
- Do not assume a compliant PR description guarantees a compliant merge commit.
- If platform-controlled metadata prevents compliance, explain and stop
  unless I approve a specific exception.

Do not push, open PRs, merge, publish releases, or change repository settings
unless authorized for the task.

Naming an account does not itself authorize these actions.


## 13. GitHub Actions and repository automation

Inspect automation that creates commits, including:
- Formatting and lint-fix workflows.
- Version-bump workflows.
- Changelog and release workflows.
- Documentation generation.
- Dependency updates.
- Generated-file updates.

Do not introduce automation that silently commits as an agent or bot when
the requirement is owner-only attribution.

Preferred approach:
- Run checks and produce artifacts without committing.
- Leave changes for an explicitly authorized owner-attributed commit.

If a workflow must create commits:
- Explain its design and attribution implications.
- Obtain approval before changing it.
- Use the approved owner identity only for authorized owner-directed automation.
- Verify resulting author, committer, and message metadata.
- Distinguish commit identity from the GitHub Actions activity actor.

Never:
- Expose tokens or embed credentials.
- Bypass repository permissions.
- Relabel genuinely independent third-party work as mine.
- Disable all GitHub Actions merely to remove one bot's attribution.

Identify the responsible workflow and propose the smallest appropriate change.


## 14. Verification gates

### Before committing

Confirm:
- Correct repository and branch.
- Persistent PRIMARY selection.
- Effective account for this task.
- Explicit scope of any SECONDARY exception.
- Intended staged changes.
- Effective author and committer identity.
- Absence of conflicting configuration/environment overrides.
- Full proposed commit message.
- Whether templates, hooks, or tool settings can add unwanted attribution.

### After committing

Inspect the actual resulting commit, not just the command used to create it.

A useful inspection command is:

git log -1 --format=fuller

Verify:
- Author name/email.
- Committer name/email.
- Full message and trailers.
- Required signing status, where applicable.

### Before pushing

Identify:
- Exact destination remote URL.
- Exact destination branch.
- Intended authentication account.
- Exact outgoing commit range.

Inspect EVERY outgoing commit for:
- Author and committer metadata.
- Full commit message and trailers.
- Unexpected commits.
- Unwanted AI/bot attribution.

Do not assume HEAD~1 represents the complete outgoing range.

For a new branch or a branch without an upstream:
- Determine the correct comparison base from the intended remote and topology.
- Do not guess.

If outgoing commits include legitimate prior SECONDARY or third-party work:
- Distinguish existing history from newly created task commits.
- Do not relabel that history automatically.
- Report any conflict with the intended publishing requirements.

### After pushing

When access is available:
- Verify the remote branch and resulting commit SHA(s).
- Distinguish verified remote state from local-only inspection.
- Do not claim the GitHub contributor display has updated unless observed.

If any required check fails:
- Stop the affected publishing step.
- Explain the failure.
- Do not bypass it.


## 15. Existing history and third-party contributions

This policy does not authorize automatic history rewriting.

Do not automatically:
- Rewrite published commits.
- Rebase shared history.
- Amend published commits.
- Force-push.
- Delete branches or tags.
- Remove genuine human authorship.
- Rewrite upstream or vendor history.
- Treat .mailmap as a guaranteed substitute for removing unwanted attribution.

If unwanted agent or bot attribution exists:
1. Perform a read-only audit first.
2. Identify affected commits and branches.
3. Distinguish author, committer, co-author trailer, and platform activity actor.
4. Identify workflows, hooks, templates, or tool settings that may reintroduce it.
5. Separate confirmed causes from hypotheses.
6. Propose a prevention fix.
7. Propose a separate, scoped historical cleanup plan.
8. Explain backup, collaboration, signature, and commit-hash implications.
9. Obtain explicit approval before rewriting history or force-pushing.

If an incorrect commit was just created locally and remains unpublished:
- Report it.
- Correct it only if local amendment is already authorized for the task.
- Otherwise ask before amending.
- Re-run all checks afterward.

Never erase legitimate third-party credit simply to make the contributor
count equal one.

Using both approved accounts to author commits may legitimately produce two
owner-account contributor entries. SECONDARY is not a hidden identity, and
its use does not guarantee that only PRIMARY will appear as a contributor.


## 16. Enforcement and limitations

Do not rely only on remembering this prompt.

Where authorized, propose:
- A local commit-message check for prohibited attribution.
- A local pre-push check of outgoing commits.
- A CI check for commits introduced by a proposed change.
- Appropriate branch rules requiring relevant checks before merging.

Account-aware checks must respect explicitly authorized SECONDARY tasks.
Do not make a temporary exception a permanent bypass.

Explain limitations:
- Local hooks require installation and can be bypassed.
- CI generally detects a pushed commit rather than preventing the initial push.
- Branch rules protect only the operations and branches they cover.
- A prompt cannot override mandatory platform behavior.
- A clean latest commit does not prove the entire repository history is clean.

Do not install hooks, modify workflows, or change branch rules without
authorization.

Do not bypass identity-policy failures using --no-verify or similar workarounds.


## 17. Completion report

After authorized Git/GitHub work, report:

- Persistent PRIMARY account.
- Effective account used for this task.
- Whether a SECONDARY exception was used and its scope.
- Actual author name/email for new commits.
- Actual committer name/email for new commits.
- Commit SHA(s) created.
- Attribution checks performed and results.
- Destination repository and branch, if publishing occurred.
- Push/PR status.
- Authentication identity, if verified; otherwise mark it unverified.
- Any platform-controlled identity or other limitation.
- Whether PRIMARY has been restored as the default.

If no commit, push, or PR was created, say so.

Do not claim "only your account is a contributor" based solely on the latest
commit. That requires relevant historical inspection and checking the actual
GitHub result.


## 18. Immediate startup behavior

Before your first commit or publishing operation:

1. Read the existing project instructions and this policy.
2. Look for a persisted PRIMARY/SECONDARY selection.
3. If no confirmed selection exists, ask the account-selection question
   from Section 3 and wait for my answer.
4. If a confirmed selection exists, use it without asking unnecessarily.
5. Resolve any explicitly authorized active SECONDARY exception.
6. Confirm the effective account.
7. Verify identity configuration and attribution controls.
8. Continue within the task's authorization.

Do not create an initial commit before the account selection is resolved.
Do not assume a new branch means a new account selection.
Do not silently switch accounts because credentials or platform defaults differ.

PRIMARY is the default for every branch and every new task.
SECONDARY is used only when I explicitly authorize it for particular work.