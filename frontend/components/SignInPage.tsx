'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogIn, Film } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function SignInPage() {
  const { signIn, isLoading } = useAuth();

  const handleSignIn = async () => {
    try {
      const result = await signIn();
      if (!result) {
        // If Firebase isn't working, show an error message
        alert('Firebase authentication is not configured. Please check your environment variables.');
      }
    } catch (error) {
      console.error('Sign in failed:', error);
      alert('Sign in failed. Please check your Firebase configuration.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
      <Card className="w-full max-w-md bg-slate-800/50 backdrop-blur border-slate-700">
        <CardHeader className="text-center pb-6">
          <div className="w-16 h-16 bg-purple-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Film className="w-8 h-8 text-purple-400" />
          </div>
          <CardTitle className="text-3xl font-bold text-white mb-2">
            WritersRoom
          </CardTitle>
          <p className="text-slate-300">
            Professional screenwriting meets AI assistance
          </p>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="text-center">
            <p className="text-slate-400 text-sm mb-6">
              Sign in to access your scripts and collaborate with AI
            </p>
          </div>
          
          <Button
            onClick={handleSignIn}
            disabled={isLoading}
            className="w-full bg-white hover:bg-gray-100 text-gray-900 font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-3"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-900 rounded-full animate-spin" />
            ) : (
              <LogIn className="w-5 h-5" />
            )}
            {isLoading ? 'Signing in...' : 'Sign in with Google'}
          </Button>
          
          <div className="text-center">
            <p className="text-xs text-slate-500">
              By signing in, you agree to our terms of service and privacy policy
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
