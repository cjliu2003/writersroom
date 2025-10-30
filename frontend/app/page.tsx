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
import { MoviePosterBanner } from "@/components/MoviePosterBanner";

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
    return <LoadingOverlay isVisible={true} title="Initializing WritersRoom" />;
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
      {/* Background layers */}
      <MoviePosterBanner />
      <div className="fixed inset-0 bg-white/85 backdrop-blur-sm z-0 pointer-events-none" />

      {/* Overlays */}
      <DragOverlay isVisible={isDragging} />
      <LoadingOverlay isVisible={isParsing} title="Processing your screenplay" />

      {/* Main content */}
      <div className="min-h-screen p-6 relative z-10" onDrop={handleDrop}>
        <div className="max-w-7xl mx-auto">
          {/* User Menu - Top Right */}
          <div className="absolute top-8 right-8 flex items-center gap-4 z-20">
            <div className="flex items-center gap-2 text-slate-900 text-sm">
              <User className="w-4 h-4" />
              <span>{user.displayName || user.email}</span>
            </div>
            <Button onClick={signOut} variant="ghost" size="sm" className="text-slate-700 hover:text-slate-900 hover:bg-white/50">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>

          {/* Hero Header */}
          <div className="text-center mb-16 pt-12">
            <h1 className="text-7xl md:text-8xl font-black text-slate-900 mb-6 tracking-tight">
              Your Scripts
            </h1>
            <p className="text-2xl md:text-3xl text-slate-700 font-light tracking-wide">
              Where stories begin
            </p>
          </div>

          {/* Hero Actions */}
          <div className="max-w-4xl mx-auto mb-16">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Upload - Primary CTA */}
              <div className={`relative transition-all duration-300 ${isDragging ? 'scale-[1.02]' : ''}`}>
                <input type="file" accept=".fdx" onChange={handleFileSelect} className="hidden" id="fdx-upload" disabled={isUploading} />
                <button
                  onClick={() => document.getElementById('fdx-upload')?.click()}
                  disabled={isUploading}
                  className={`w-full px-12 py-16 bg-white/90 backdrop-blur-xl border-4 rounded-2xl transition-all duration-300 hover:scale-[1.02] shadow-2xl disabled:opacity-60 disabled:cursor-not-allowed ${isDragging ? 'border-blue-500 bg-blue-50/90 ring-4 ring-blue-500/30' : 'border-slate-300 hover:bg-white hover:border-slate-400'}`}
                >
                  {isUploading ? (
                    <>
                      <div className="w-16 h-16 border-4 border-blue-600/30 border-t-blue-600 rounded-full animate-spin mx-auto mb-6" />
                      <div className="text-2xl font-bold text-slate-900 mb-2">Processing...</div>
                      <div className="text-slate-600">Importing your screenplay</div>
                    </>
                  ) : (
                    <>
                      <Upload className="w-16 h-16 text-blue-600 mx-auto mb-6" />
                      <div className="text-2xl font-bold text-slate-900 mb-2">Upload Script</div>
                      <div className="text-slate-600">Drop FDX file or click to browse</div>
                    </>
                  )}
                </button>
              </div>

              {/* Create New - Secondary CTA */}
              <button
                onClick={createNewScript}
                className="w-full px-12 py-16 bg-white/90 backdrop-blur-xl border-4 border-slate-300 rounded-2xl hover:bg-white hover:border-slate-400 transition-all duration-300 hover:scale-[1.02] shadow-2xl"
              >
                <Plus className="w-16 h-16 text-purple-600 mx-auto mb-6" />
                <div className="text-2xl font-bold text-slate-900 mb-2">Start New Script</div>
                <div className="text-slate-600">Create from scratch</div>
              </button>
            </div>
          </div>

          {/* Scripts Section */}
          {loadingScripts ? (
            <div className="max-w-6xl mx-auto text-center py-16">
              <div className="w-16 h-16 border-4 border-slate-300/50 border-t-slate-700 rounded-full animate-spin mx-auto mb-6" />
              <p className="text-xl text-slate-700">Loading your scripts...</p>
            </div>
          ) : scripts.length > 0 ? (
            <div className="max-w-6xl mx-auto">
              <h2 className="text-3xl font-bold text-slate-900 mb-8">Recent Scripts</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {scripts.slice(0, 6).map((p) => (
                  <Card
                    key={p.script_id}
                    className="border-2 border-slate-200 bg-white/90 backdrop-blur-md shadow-xl hover:bg-white hover:border-slate-300 transition-all duration-300 cursor-pointer hover:scale-[1.02] hover:shadow-2xl"
                    onClick={() => openProject(p.script_id)}
                  >
                    <CardHeader className="pb-4">
                      <div className="flex items-start justify-between">
                        <div className="w-14 h-14 rounded-xl bg-slate-100 flex items-center justify-center">
                          <FileText className="w-8 h-8 text-slate-700" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <h3 className="text-slate-900 font-bold text-xl mb-3 line-clamp-2">{p.title}</h3>
                      {p.description && (
                        <p className="text-sm text-slate-600 mb-4 line-clamp-2">{p.description}</p>
                      )}
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Clock className="w-4 h-4" />
                        <span>{formatDate(p.updated_at)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {scripts.length > 6 && (
                <div className="text-center mt-8">
                  <p className="text-slate-600">
                    Showing 6 of {scripts.length} scripts
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {/* Empty state */}
          {!loadingScripts && scripts.length === 0 && (
            <div className="max-w-2xl mx-auto text-center py-20">
              <div className="w-24 h-24 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-8">
                <FileText className="w-12 h-12 text-slate-400" />
              </div>
              <h3 className="text-3xl font-bold text-slate-900 mb-4">Your creative journey begins here</h3>
              <p className="text-xl text-slate-600">Upload your first screenplay or start writing something new</p>
            </div>
          )}

          {/* Error */}
          {uploadError && (
            <div className="max-w-2xl mx-auto mb-8">
              <div className="flex items-center gap-4 text-red-800 bg-red-50/95 backdrop-blur-xl p-6 rounded-xl border-2 border-red-200 shadow-xl">
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl">⚠️</span>
                </div>
                <div>
                  <div className="font-bold text-lg mb-1">Upload Failed</div>
                  <div className="text-red-700">{uploadError}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Title Modal */}
      {showTitleModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50">
          <div className="bg-white/95 backdrop-blur-xl border-2 border-slate-200 rounded-2xl shadow-2xl p-10 max-w-lg w-full mx-4 relative">
            <Button onClick={handleCancelModal} variant="ghost" size="sm" className="absolute top-6 right-6 text-slate-500 hover:text-slate-900 hover:bg-slate-100">
              <X className="w-5 h-5" />
            </Button>
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <FileText className="w-10 h-10 text-purple-600" />
              </div>
              <h2 className="text-3xl font-bold text-slate-900 mb-3">Create New Script</h2>
              <p className="text-lg text-slate-600">What&apos;s the title of your masterpiece?</p>
            </div>
            <div className="mb-8">
              <input type="text" value={newScriptTitle} onChange={(e) => setNewScriptTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleCreateScript(); if (e.key === 'Escape') handleCancelModal(); }} placeholder="Enter script title..." className="w-full px-5 py-4 bg-white border-2 border-slate-300 rounded-xl text-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-4 focus:ring-purple-500/20 focus:border-purple-500 transition-all" autoFocus />
            </div>
            <div className="flex gap-4">
              <Button onClick={handleCancelModal} variant="ghost" className="flex-1 py-3 text-lg font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl">Cancel</Button>
              <Button onClick={handleCreateScript} disabled={!newScriptTitle.trim()} className="flex-1 py-3 text-lg font-semibold bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-lg hover:shadow-xl transition-all">Create Script</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
