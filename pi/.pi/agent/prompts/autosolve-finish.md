---
description: Finalize solving a jira issue by creating a PR
---

1. run lintfix (fix problems if needed)
2. run unit test

-> iterate 1 and 2 until there are not more errors

3. create a commit message using the commit message skill
4. IF it is a simple UI fix and does not require interactions
   -> create a screenshot (chrome-devtools skill) and add it to the PR description
   ELSE IF it requires dynamic UI interaction
   -> ask the user (question tool multiple choice) if a recent screencast ~/Videos/Screencasts was created showing a proof of fix and let them select it, also give the option to decline
   ELSE IF unsure
   -> ask the user if a proof of fix screencast/image is needed
5. create a pull request (use the gh-media-upload skill if needed)

$@
