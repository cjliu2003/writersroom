'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CollaborativeEditorExample } from '@/components/collaborative-editor-example';
import { useAuth } from '@/contexts/AuthContext';

export default function TestCollabPage() {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const { user, isLoading, getToken } = useAuth();
  const searchParams = useSearchParams();
  const sceneId = searchParams.get('sceneId') || '69b854e2-9dd0-473b-b844-0232d4edaf72'; // Default to your scene

  useEffect(() => {
    if (user) {
      getToken().then(token => setAuthToken(token));
    }
  }, [user, getToken]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!authToken) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-red-600">Please sign in to test collaboration</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-4">
        <h1 className="text-3xl font-bold">Real-time Collaboration Test</h1>
        <p className="text-gray-600 mt-2">
          Open this page in multiple browsers to test collaboration
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Scene ID: <code className="bg-gray-100 px-2 py-1 rounded">{sceneId}</code>
        </p>
      </div>
      
      <CollaborativeEditorExample 
        sceneId={sceneId}
        authToken={authToken}
      />
    </div>
  );
}
