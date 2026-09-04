---
name: False Positive Report
about: The plugin reported a memory leak where there is none
title: "[FALSE POSITIVE] "
labels: false-positive
assignees: ''
---

**Rule ID**
e.g., `generic/no-uncleared-timers`

**Code snippet**
Please provide the exact code snippet that triggered the false positive:

```typescript
// Paste your code here
```

**Why is this a false positive?**
Explain why this code is actually safe and shouldn't trigger a warning.
E.g., "The timer is passed to `myCustomCleanupUtility` which clears it automatically."

**Suggested fix (optional)**
If you have an idea for how the rule could be improved to avoid this false positive, describe it here.
