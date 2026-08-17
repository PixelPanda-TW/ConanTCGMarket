Status: DONE

Commits created:
- `Add marketplace domain models`.

Tests run and exact results:
- `VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test -- src/domain/models/domainModels.test.ts`: 1 test file passed, 5 tests passed.
- `VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm test`: 5 test files passed, 13 tests passed.
- `VITE_FIREBASE_API_KEY=fake-api-key VITE_FIREBASE_AUTH_DOMAIN=fake-project.firebaseapp.com VITE_FIREBASE_PROJECT_ID=fake-project VITE_FIREBASE_STORAGE_BUCKET=fake-project.appspot.com VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012 VITE_FIREBASE_APP_ID=1:123456789012:web:fakeapp npm run build`: passed; TypeScript compilation and Vite production build succeeded.
- `git diff --check`: passed with no whitespace errors.

Files changed:
- `src/domain/models/card.ts`
- `src/domain/models/listing.ts`
- `src/domain/models/sellerProfile.ts`
- `src/domain/models/sale.ts`
- `src/domain/models/index.ts`
- `src/domain/models/domainModels.test.ts`
- `.superpowers/sdd/2026-08-17-firestore-schema-repositories/task-1-report.md`

Concerns, if any:
- None.
