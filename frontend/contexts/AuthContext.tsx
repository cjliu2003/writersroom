'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { 
  signInWithGoogle, 
  logOut, 
  getCurrentUserToken, 
  subscribeToAuthChanges 
} from '@/lib/firebase';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signIn: () => Promise<User | null>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  signIn: async () => null,
  signOut: async () => {},
  getToken: async () => null,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    console.log('AuthProvider useEffect starting...');
    
    // Only run on client side
    if (typeof window === 'undefined') {
      console.log('Server side - setting loading to false');
      setIsLoading(false);
      return;
    }

    console.log('Client side - initializing Firebase auth...');

    // Add a timeout to prevent infinite loading (reduced to 3 seconds)
    const timeout = setTimeout(() => {
      console.warn('Firebase auth initialization timed out after 3 seconds');
      setIsLoading(false);
    }, 3000);

    // Also set a shorter fallback timeout
    const fallbackTimeout = setTimeout(() => {
      console.log('Fallback timeout - setting loading to false');
      setIsLoading(false);
    }, 1000);

    try {
      const unsubscribe = subscribeToAuthChanges((user) => {
        console.log('Auth state changed:', user ? `User: ${user.email}` : 'No user');
        clearTimeout(timeout);
        clearTimeout(fallbackTimeout);
        setUser(user);
        setIsLoading(false);
      });

      return () => {
        console.log('Cleaning up auth subscription');
        clearTimeout(timeout);
        clearTimeout(fallbackTimeout);
        unsubscribe();
      };
    } catch (error) {
      console.error('Failed to initialize Firebase auth:', error);
      clearTimeout(timeout);
      clearTimeout(fallbackTimeout);
      setIsLoading(false);
      return () => {};
    }
  }, []);

  const signIn = async (): Promise<User | null> => {
    try {
      const user = await signInWithGoogle();
      return user;
    } catch (error) {
      console.error('Error signing in:', error);
      return null;
    }
  };

  const signOutUser = async (): Promise<void> => {
    try {
      await logOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const getToken = async (): Promise<string | null> => {
    try {
      return await getCurrentUserToken();
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  };

  const value = {
    user,
    isLoading,
    signIn,
    signOut: signOutUser,
    getToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
