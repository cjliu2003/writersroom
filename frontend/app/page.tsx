"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SignInPage from "@/components/SignInPage";
import { useAuth } from "@/contexts/AuthContext";
import { getUserScripts, uploadFDXFile, type ScriptSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Upload, FileText, Plus, Clock, LogOut, User, X } from "lucide-react";
import DragOverlay from "@/components/DragOverlay";
import LoadingOverlay from "@/components/LoadingOverlay";

export default function HomePage() {
  const { user, isLoading: authLoading, signOut } = useAuth();
  const router = useRouter();

  // UI state
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [newScriptTitle, setNewScriptTitle] = useState("");

  // Data state
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // NOTE: Do not early-return before hooks. Auth gating moved below effects.

  // Load user's scripts when a user is present
  useEffect(() => {
    let mounted = true;
    if (!user) {
      // Ensure list is cleared and not loading when signed out
      setScripts([]);
      setLoadingScripts(false);
      return () => { mounted = false; };
    }

    const load = async () => {
      setLoadingScripts(true);
      try {
        const result = await getUserScripts();
        if (mounted) setScripts(result);
      } catch (e) {
        console.error("Failed to load user scripts:", e);
      } finally {
        if (mounted) setLoadingScripts(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [user]);

  // Global drag-overlay listeners
  useEffect(() => {
    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        setIsDragging(false);
      }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setIsDragging(false);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // Auth gating AFTER hooks to keep hook order stable
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }
  if (!user) return <SignInPage />;

  // Handlers
  const openProject = (projectId: string) => router.push(`/script-editor?scriptId=${projectId}`);

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setIsParsing(true);
    setUploadError(null);
    try {
      const res = await uploadFDXFile(file);
      // Optimistically add script and navigate
      setScripts(prev => [{
        script_id: res.script_id,
        title: res.title,
        description: `Imported from ${file.name}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, ...prev]);
      router.push(`/script-editor?scriptId=${res.script_id}`);
    } catch (e: any) {
      console.error("Upload failed:", e);
      setUploadError(e?.message || "Upload failed. Please try again.");
      setIsUploading(false);
      setIsParsing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".fdx")) {
      setUploadError("Please upload a .fdx file");
      return;
    }
    handleFileUpload(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.toLowerCase().endsWith(".fdx")) {
      handleFileUpload(file);
    }
  };

  const createNewScript = () => setShowTitleModal(true);
  const handleCancelModal = () => { setShowTitleModal(false); setNewScriptTitle(""); };
  const handleCreateScript = () => {
    const title = newScriptTitle.trim();
    if (!title) return;
    const projectId = `new-${Date.now()}`;
    router.push(`/script-editor?scriptId=${projectId}&new=true&title=${encodeURIComponent(title)}`);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
  };

  // Render styled UI
  return (
    <>
      <DragOverlay isVisible={isDragging} />
      <LoadingOverlay isVisible={isParsing} title="Processing your screenplay" />

      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6" onDrop={handleDrop}>
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-center mb-12">
            <div className="text-center flex-1">
              <h1 className="text-5xl font-bold text-white mb-4">WritersRoom</h1>
              <p className="text-slate-300 text-xl">Professional screenwriting meets AI assistance</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-white">
                <User className="w-5 h-5" />
                <span>{user.displayName || user.email}</span>
              </div>
              <Button onClick={signOut} variant="outline" size="sm" className="text-white border-white hover:bg-white/10">
                <LogOut className="w-4 h-4 mr-2" /> Sign Out
              </Button>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
            {/* Upload Card */}
            <Card className={`border-2 border-dashed transition-all duration-200 cursor-pointer hover:scale-[1.02] ${isDragging ? 'border-purple-400 bg-purple-50/10 ring-4 ring-purple-400 shadow-lg shadow-purple-500/20' : 'border-slate-600 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-800/70'} backdrop-blur`}>
              <CardContent className="p-6 text-center">
                <input type="file" accept=".fdx" onChange={handleFileSelect} className="hidden" id="fdx-upload" disabled={isUploading} />
                <Button onClick={() => document.getElementById('fdx-upload')?.click()} variant="ghost" disabled={isUploading} className="h-auto flex flex-col items-center space-y-3 w-full p-6 hover:bg-transparent text-slate-300 hover:text-white">
                  {isUploading ? (
                    <>
                      <div className="w-12 h-12 border-2 border-blue-600/50 border-t-blue-600 rounded-full animate-spin" />
                      <span className="text-sm opacity-60">Processing...</span>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-lg bg-blue-600/20 flex items-center justify-center">
                        <Upload className="w-6 h-6 text-blue-400" />
                      </div>
                      <div>
                        <p className="font-semibold">Upload a Script</p>
                        <p className="text-xs text-slate-400">Drop FDX file or click</p>
                      </div>
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* New Project Card */}
            <Card className="border-slate-700 bg-slate-800/50 backdrop-blur hover:bg-slate-800/70 transition-all duration-200 cursor-pointer hover:scale-[1.02]">
              <CardContent className="p-6 text-center">
                <Button onClick={createNewScript} variant="ghost" className="h-auto flex flex-col items-center space-y-3 w-full p-6 hover:bg-transparent text-slate-300 hover:text-white">
                  <div className="w-12 h-12 rounded-lg bg-purple-600/20 flex items-center justify-center">
                    <Plus className="w-6 h-6 text-purple-400" />
                  </div>
                  <div>
                    <p className="font-semibold">Start New Script</p>
                    <p className="text-xs text-slate-400">Create from scratch</p>
                  </div>
                </Button>
              </CardContent>
            </Card>

            {/* Loading State */}
            {loadingScripts && (
              <Card className="border-slate-700 bg-slate-800/50 backdrop-blur">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 border-2 border-slate-600/50 border-t-slate-400 rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-slate-400">Loading your scripts...</p>
                </CardContent>
              </Card>
            )}

            {/* Scripts */}
            {scripts.map((p) => (
              <Card key={p.script_id} className="border-slate-700 bg-slate-800/50 backdrop-blur hover:bg-slate-800/70 transition-all duration-200 cursor-pointer hover:scale-[1.02]" onClick={() => openProject(p.script_id)}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <FileText className="w-8 h-8 text-slate-400 flex-shrink-0" />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <h3 className="text-white font-semibold text-lg mb-2 truncate">{p.title}</h3>
                  <div className="space-y-1 text-sm text-slate-400">
                    {p.description && (
                      <p className="text-xs text-slate-500 truncate">{p.description}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{formatDate(p.updated_at)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Empty state */}
          {!loadingScripts && scripts.length === 0 && (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">No scripts yet</h3>
              <p className="text-slate-400 mb-6">Upload an FDX file or create a new script to get started</p>
            </div>
          )}

          {/* Error */}
          {uploadError && (
            <div className="max-w-md mx-auto mb-8">
              <div className="flex items-center gap-2 text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-800">
                <span className="font-medium">Upload Failed</span>
                <span className="text-sm">{uploadError}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Title Modal */}
      {showTitleModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-600 rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 relative">
            <Button onClick={handleCancelModal} variant="ghost" size="sm" className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </Button>
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-purple-600/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-purple-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Create New Script</h2>
              <p className="text-slate-300">What&apos;s the title of your masterpiece?</p>
            </div>
            <div className="mb-6">
              <input type="text" value={newScriptTitle} onChange={(e) => setNewScriptTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleCreateScript(); if (e.key === 'Escape') handleCancelModal(); }} placeholder="Enter script title..." className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent" autoFocus />
            </div>
            <div className="flex gap-3">
              <Button onClick={handleCancelModal} variant="ghost" className="flex-1 text-slate-300 hover:text-white hover:bg-slate-700/50">Cancel</Button>
              <Button onClick={handleCreateScript} disabled={!newScriptTitle.trim()} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed">Create Script</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
