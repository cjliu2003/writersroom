"use client"

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, UserPlus, Users, X } from 'lucide-react';
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

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/20 backdrop-blur-md flex items-center justify-center z-50"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="backdrop-blur-xl bg-white/70 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] border border-white/30 pt-10 px-10 pb-8 max-w-lg w-full mx-4 relative"
          style={{ fontFamily: 'var(--font-courier-prime), "Courier New", monospace' }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-5">
              <Users
                className="h-12 w-12 text-violet-400 drop-shadow-[0_0_10px_rgba(167,139,250,0.4)]"
                strokeWidth={1.5}
              />
            </div>
            <h2 className="text-2xl font-mono text-gray-800 tracking-wide mb-2">
              Share Script
            </h2>
            {scriptTitle && (
              <p className="font-[family-name:var(--font-courier-prime)] text-lg text-gray-700 uppercase underline decoration-1 underline-offset-4">
                {scriptTitle}
              </p>
            )}
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-50/80 border border-red-200/50 text-red-700 px-5 py-3 rounded-xl text-base mb-5">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50/80 border border-green-200/50 text-green-700 px-5 py-3 rounded-xl text-base mb-5">
              {success}
            </div>
          )}

          {/* Add Collaborator Form - Only for owners */}
          {isOwner && (
            <form onSubmit={handleAddCollaborator} className="mb-8">
              <div className="flex gap-3">
                <input
                  type="email"
                  placeholder="Enter email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isAdding}
                  className="flex-1 px-5 py-3 rounded-xl border border-violet-200/50 bg-white/70 focus:ring-2 focus:ring-violet-400 focus:border-violet-400 font-mono text-base text-gray-700 placeholder:text-gray-400 transition-all shadow-inner outline-none"
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
                  disabled={isAdding}
                  className="px-4 py-3 rounded-xl border border-violet-200/50 bg-white/70 text-base text-gray-700 focus:ring-2 focus:ring-violet-400 focus:border-violet-400 transition-all outline-none cursor-pointer"
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="submit"
                  disabled={isAdding || !email.trim()}
                  className="px-5 py-3 rounded-xl bg-violet-500/90 hover:bg-violet-500 text-white text-base font-medium shadow-[0_0_10px_rgba(167,139,250,0.3)] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  {isAdding ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <UserPlus className="w-6 h-6" />
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Collaborators List */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">
                Collaborators
              </p>
              {isLoading && (
                <div className="w-4 h-4 border-2 border-violet-300/50 border-t-violet-500 rounded-full animate-spin" />
              )}
            </div>

            <div className="max-h-56 overflow-y-auto space-y-2">
              {!isLoading && collaborators.length === 0 ? (
                <p className="text-base text-gray-400 py-2">No collaborators yet</p>
              ) : (
                collaborators.map((collab) => (
                  <div
                    key={collab.user_id}
                    className="flex items-center justify-between p-4 bg-white/50 rounded-xl group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-medium text-gray-800 truncate">
                        {collab.display_name || 'Unknown User'}
                      </div>
                      <div className="text-sm text-gray-500">
                        {collab.role === 'editor' ? 'Can edit' : 'Can view'} · Joined {formatDate(collab.joined_at)}
                      </div>
                    </div>
                    {isOwner && (
                      <button
                        onClick={() => handleRemoveCollaborator(collab.user_id, collab.display_name)}
                        className="p-2 rounded-lg text-gray-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50/50 transition-all ml-2"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
