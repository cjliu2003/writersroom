"use client"

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, UserPlus, Users } from 'lucide-react';
import { getCollaborators, addCollaborator, removeCollaborator, type Collaborator } from '@/lib/api';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  scriptId: string;
  scriptTitle?: string;
  isOwner: boolean;
}

export function ShareDialog({ isOpen, onClose, scriptId, scriptTitle, isOwner }: ShareDialogProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [isAdding, setIsAdding] = useState(false);

  // Load collaborators when dialog opens
  useEffect(() => {
    if (isOpen && scriptId) {
      loadCollaborators();
    }
  }, [isOpen, scriptId]);

  // Clear messages after a delay
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const loadCollaborators = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getCollaborators(scriptId);
      setCollaborators(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load collaborators');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsAdding(true);
    setError(null);
    setSuccess(null);

    try {
      const newCollaborator = await addCollaborator(scriptId, email.trim(), role);
      setCollaborators([...collaborators, newCollaborator]);
      setEmail('');
      setSuccess(`Added ${newCollaborator.display_name || email} as ${role}`);
    } catch (err: any) {
      setError(err.message || 'Failed to add collaborator');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveCollaborator = async (userId: string, displayName: string | null) => {
    setError(null);
    try {
      await removeCollaborator(scriptId, userId);
      setCollaborators(collaborators.filter(c => c.user_id !== userId));
      setSuccess(`Removed ${displayName || 'collaborator'}`);
    } catch (err: any) {
      setError(err.message || 'Failed to remove collaborator');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Share Script
          </DialogTitle>
          <DialogDescription>
            {scriptTitle ? `Share "${scriptTitle}" with others` : 'Invite collaborators to edit or view this script'}
          </DialogDescription>
        </DialogHeader>

        {/* Error/Success Messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded text-sm">
            {success}
          </div>
        )}

        {/* Add Collaborator Form - Only for owners */}
        {isOwner && (
          <form onSubmit={handleAddCollaborator} className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="email" className="sr-only">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isAdding}
                />
              </div>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
                disabled={isAdding}
                className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <Button type="submit" disabled={isAdding || !email.trim()} className="w-full">
              <UserPlus className="w-4 h-4 mr-2" />
              {isAdding ? 'Adding...' : 'Add Collaborator'}
            </Button>
          </form>
        )}

        {/* Collaborators List */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            {collaborators.length > 0 ? 'Collaborators' : 'No collaborators yet'}
          </Label>

          {isLoading ? (
            <div className="text-sm text-gray-500 py-4 text-center">Loading...</div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-2">
              {collaborators.map((collab) => (
                <div
                  key={collab.user_id}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded-md"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {collab.display_name || 'Unknown User'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {collab.role === 'editor' ? 'Can edit' : 'Can view'} · Joined {formatDate(collab.joined_at)}
                    </div>
                  </div>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveCollaborator(collab.user_id, collab.display_name)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 ml-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
