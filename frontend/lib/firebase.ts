import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { 
  getAuth, 
  Auth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// Initialize Firebase only on client side
let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

const initializeFirebase = () => {
  // Only initialize on client side
  if (typeof window === 'undefined') {
    return null;
  }

  // Debug: Log what environment variables we have
  console.log('Firebase config check:', {
    apiKey: firebaseConfig.apiKey ? 'present' : 'missing',
    authDomain: firebaseConfig.authDomain ? 'present' : 'missing',
    projectId: firebaseConfig.projectId ? 'present' : 'missing',
    appId: firebaseConfig.appId ? 'present' : 'missing'
  });

  // Check if all required config values are present
  const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const missingKeys = requiredKeys.filter(key => !firebaseConfig[key as keyof typeof firebaseConfig]);
  
  if (missingKeys.length > 0) {
    console.warn('Missing Firebase config keys:', missingKeys);
    console.warn('Please check your .env.local file has the following variables:');
    console.warn('NEXT_PUBLIC_FIREBASE_API_KEY');
    console.warn('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN');
    console.warn('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
    console.warn('NEXT_PUBLIC_FIREBASE_APP_ID');
    return null;
  }

  try {
    // Check if Firebase is already initialized
    if (getApps().length === 0) {
      firebaseApp = initializeApp(firebaseConfig);
    } else {
      firebaseApp = getApps()[0];
    }
    firebaseAuth = getAuth(firebaseApp);
    return firebaseAuth;
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    return null;
  }
};

// Get auth instance (lazy initialization)
export const getFirebaseAuth = (): Auth | null => {
  if (!firebaseAuth) {
    firebaseAuth = initializeFirebase();
  }
  return firebaseAuth;
};

// Configure Google Auth Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');

// Authentication functions
export const signInWithGoogle = async (): Promise<User> => {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('Firebase auth not initialized');
  }
  
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Error signing in with Google:', error);
    throw error;
  }
};

export const logOut = async (): Promise<void> => {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('Firebase auth not initialized');
  }
  
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Error signing out:', error);
    throw error;
  }
};

// Function to get the current user's ID token
export const getCurrentUserToken = async (): Promise<string | null> => {
  const auth = getFirebaseAuth();
  if (!auth) {
    return null;
  }
  
  try {
    const user = auth.currentUser;
    if (!user) {
      return null;
    }
    
    return await user.getIdToken();
  } catch (error) {
    console.error('Error getting ID token:', error);
    return null;
  }
};

// Subscribe to auth state changes
export const subscribeToAuthChanges = (
  callback: (user: User | null) => void
): (() => void) => {
  console.log('subscribeToAuthChanges called');
  
  const auth = getFirebaseAuth();
  if (!auth) {
    console.warn('Firebase auth not available, user will remain signed out');
    // Call callback immediately with null to prevent infinite loading
    setTimeout(() => {
      console.log('Calling callback with null user (no auth)');
      callback(null);
    }, 100);
    return () => {};
  }
  
  console.log('Firebase auth available, setting up onAuthStateChanged');
  
  try {
    return onAuthStateChanged(auth, 
      (user) => {
        console.log('onAuthStateChanged triggered:', user ? `User: ${user.email}` : 'No user');
        callback(user);
      }, 
      (error) => {
        console.error('Auth state change error:', error);
        callback(null);
      }
    );
  } catch (error) {
    console.error('Failed to subscribe to auth changes:', error);
    // Call callback with null to prevent infinite loading
    setTimeout(() => {
      console.log('Calling callback with null user (error)');
      callback(null);
    }, 100);
    return () => {};
  }
};
