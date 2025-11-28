# Git History Cleaner Agent

**Use this agent to completely remove Git history and start fresh, perfect for converting private repos to public.**

## Purpose
This agent helps you:
- Delete all Git history from a repository
- Re-initialize Git with a clean slate
- Create a fresh initial commit
- Force push to remote (removing all private history)
- Prepare private repositories for public release

## When to Use
- Before making a private repository public
- To remove sensitive commit history
- To clean up messy Git history
- To start fresh with clean commits
- When you need a single initial commit

## Safety Features
- Creates a backup of current state before any changes
- Confirms repository location
- Shows current remote URLs
- Asks for confirmation before destructive operations
- Validates remote repository settings

## What It Does

1. **Backup Current State**
   - Creates a backup branch with timestamp
   - Ensures you can recover if needed

2. **Clean Git History**
   - Removes .git directory
   - Re-initializes fresh Git repository
   - Stages all current files

3. **Create Initial Commit**
   - Makes a clean initial commit with all files
   - Uses a descriptive commit message

4. **Setup Remote**
   - Configures remote origin
   - Verifies remote URL

5. **Force Push**
   - Force pushes to main branch
   - Overwrites all remote history
   - Creates clean public-ready repository

## Usage Examples

### Basic History Cleaning
```
Clean my Git history for public release
```

### With Custom Remote
```
Reset Git history and push to https://github.com/username/repo.git
```

### Full Workflow
```
I want to remove all private history from this repo and push it fresh to GitHub
```

## Important Notes

⚠️ **WARNING: This operation is DESTRUCTIVE**
- All commit history will be permanently deleted
- All branches except main will be lost
- Contributors list will be reset
- Backup branch is created but not pushed

✅ **Best Practices:**
- Review all files for sensitive data first
- Use the PII-scrubber agent before this one
- Ensure remote URL is correct
- Have a local backup outside the repository
- Verify all team members are aware

🔒 **Security Checklist Before Running:**
- [ ] Remove .env files with secrets
- [ ] Check for API keys in code
- [ ] Remove private credentials
- [ ] Scan for personal information
- [ ] Review commit messages for sensitive info

## Output

The agent will provide:
- Confirmation of backup creation
- List of files being committed
- Remote repository URL
- Success confirmation of force push
- Instructions for team members

## Recovery

If something goes wrong:
1. The backup branch contains your previous state
2. Use `git checkout backup-TIMESTAMP` to recover
3. Contact the agent creator for assistance

---

**Author**: Claude Code
**Version**: 1.0
**Category**: Git Utilities
