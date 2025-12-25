# Release Management System

This project manages releases for both test and production environments.

## Configuration

In `scripts/release.js`, use the `isActiveTestRelease` constant to control test release management:

```javascript
const isActiveTestRelease = true; // set to false when v1 goes to production
```

- **`true`**: Test releases are active (creates `test-v*` tags)
- **`false`**: Only production releases (creates `v*` tags)

## Usage

### Test Releases (before v1 goes to production)

When `isActiveTestRelease = true`:

```bash
node scripts/release.js
```

This creates tags like `test-v1.0.0`, `test-v1.1.0`, `test-v1.2.0`.

### Production Releases (after v1 goes to production)

After setting `isActiveTestRelease = false`:

```bash
node scripts/release.js
```

This creates tags like `v1.0.0`, `v1.1.0`, `v2.0.0`.

## Jenkins Integration

No environment variables needed in Jenkins. Just use:

```groovy
stage('Release') {
    steps {
        sh 'node scripts/release.js'
        sh 'git push origin $(git describe --tags --abbrev=0)'
    }
}
```

The same command works for both test and production. The difference is the `isActiveTestRelease` value in `scripts/release.js`.

## When v1 Goes to Production

1. Set `isActiveTestRelease = false` in `scripts/release.js` (or remove the constant)
2. Delete all code sections marked with "DELETE THIS SECTION" comments
3. Remove all test-related comments

## Notes

- Test and production tags are independent
- Each environment tracks its own tag history
- Release notes are saved in the `releases/` directory
- Test release tag messages: `Release test-v1.0.0 (test)`
- Production release tag messages: `Release v1.0.0`
