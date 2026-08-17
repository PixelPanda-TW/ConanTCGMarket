import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from '../../lib/firebase/app';

export const firestoreDb = getFirestore(firebaseApp);
