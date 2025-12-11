"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import SignInPage from "@/components/SignInPage";
import { useAuth } from "@/contexts/AuthContext";
import { getUserScripts, getSharedScripts, uploadFDXFile, createScript, updateScript, deleteScript, getScriptContent, type ScriptSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, FileText, Plus, LogOut, User, X, Edit2, Trash2 } from "lucide-react";
import DragOverlay from "@/components/DragOverlay";
import ProcessingScreen from "@/components/ProcessingScreen";
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

  // Edit/Delete state
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editWrittenBy, setEditWrittenBy] = useState("Written by");
  const [editAuthor, setEditAuthor] = useState("");
  const [deletingScript, setDeletingScript] = useState<ScriptSummary | null>(null);

  // Data state
  const [scripts, setScripts] = useState<ScriptSummary[]>([]);
  const [sharedScripts, setSharedScripts] = useState<ScriptSummary[]>([]);
  const [loadingScripts, setLoadingScripts] = useState(false);

  // Separate error states for different operations
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [errorFading, setErrorFading] = useState(false);

  // NOTE: Do not early-return before hooks. Auth gating moved below effects.

  // Auto-dismiss error with gentle fade-out animation
  // Combined error display - shows whichever error is active (memoized to avoid recalculation)
  const currentError = useMemo(
    () => uploadError || editError || deleteError,
    [uploadError, editError, deleteError]
  );

  useEffect(() => {
    if (currentError) {
      // Start fade-out after 1.5 seconds
      const fadeTimer = setTimeout(() => {
        setErrorFading(true);
      }, 1500);

      // Remove error after fade-out completes (500ms fade duration)
      const removeTimer = setTimeout(() => {
        setUploadError(null);
        setEditError(null);
        setDeleteError(null);
        setErrorFading(false);
      }, 2000);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [currentError]);

  // Load user's scripts and shared scripts when a user is present
  useEffect(() => {
    let mounted = true;
    if (!user) {
      // Ensure lists are cleared and not loading when signed out
      setScripts([]);
      setSharedScripts([]);
      setLoadingScripts(false);
      return () => { mounted = false; };
    }

    const load = async () => {
      setLoadingScripts(true);
      try {
        // Fetch both owned and shared scripts in parallel
        const [ownedResult, sharedResult] = await Promise.all([
          getUserScripts(),
          getSharedScripts().catch(() => [] as ScriptSummary[]) // Graceful fallback
        ]);
        if (mounted) {
          setScripts(ownedResult);
          setSharedScripts(sharedResult);
        }
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

  // Global drag-overlay listeners (using useRef for cleaner drag counter management)
  const dragCounterRef = useRef(0);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (dragCounterRef.current === 1) setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
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

  // Handlers (memoized with useCallback to prevent unnecessary re-renders)
  // MUST be defined before early returns to satisfy React's rules of hooks
  const openProject = useCallback(
    (projectId: string) => router.push(`/script-editor?scriptId=${projectId}`),
    [router]
  );

  // Unified file validation for both select and drag-and-drop
  const validateFile = useCallback((file: File): { valid: boolean; error?: string } => {
    // Extension check
    if (!file.name.toLowerCase().endsWith(".fdx")) {
      return { valid: false, error: "Please upload a .fdx file" };
    }

    // MIME type check (FDX files are XML)
    const validMimeTypes = ['text/xml', 'application/xml', 'application/octet-stream', ''];
    if (file.type && !validMimeTypes.includes(file.type)) {
      return { valid: false, error: "Invalid file type. Please upload a valid FDX file." };
    }

    // Size check (10MB limit)
    const maxSizeMB = 10;
    if (file.size > maxSizeMB * 1024 * 1024) {
      return { valid: false, error: `File too large. Maximum size is ${maxSizeMB}MB.` };
    }

    // Basic sanity check - file should not be empty
    if (file.size === 0) {
      return { valid: false, error: "File appears to be empty" };
    }

    return { valid: true };
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    setIsParsing(true); // Show ProcessingScreen
    setUploadError(null);
    try {
      // Upload and process file
      const res = await uploadFDXFile(file);

      // Optimistically add script to list
      setScripts(prev => [{
        script_id: res.script_id,
        title: res.title,
        description: null, // Let it default to user's profile name
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, ...prev]);

      // Pre-fetch script content so editor is ready immediately
      const scriptContent = await getScriptContent(res.script_id);

      // Store in sessionStorage for instant editor load
      sessionStorage.setItem(`script_${res.script_id}`, JSON.stringify(scriptContent));

      // Navigate - editor will use cached data and render immediately
      router.push(`/script-editor?scriptId=${res.script_id}&fromUpload=true`);
    } catch (e: any) {
      console.error("Upload failed:", e);
      setUploadError(e?.message || "Upload failed. Please try again.");
      setIsUploading(false);
      setIsParsing(false);
    }
  }, [router]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      setUploadError(validation.error || "Invalid file");
      return;
    }

    handleFileUpload(file);
  }, [validateFile, handleFileUpload]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Don't stopPropagation - let global handlers clean up drag state
    const file = e.dataTransfer.files?.[0];

    if (!file) return;

    // Validate file with clear error feedback
    const validation = validateFile(file);
    if (!validation.valid) {
      setUploadError(validation.error || "Invalid file");
      return;
    }

    handleFileUpload(file);
  }, [validateFile, handleFileUpload]);

  const createNewScript = useCallback(() => setShowTitleModal(true), []);

  const handleCancelModal = useCallback(() => {
    setShowTitleModal(false);
    setNewScriptTitle("");
  }, []);

  const handleCreateScript = useCallback(async () => {
    const title = newScriptTitle.trim();
    if (!title) return;

    setIsUploading(true);
    try {
      // Create script in database first
      const newScript = await createScript({ title });

      // Navigate to editor with real script ID
      router.push(`/script-editor?scriptId=${newScript.script_id}`);
    } catch (error) {
      console.error('[HomePage] Failed to create script:', error);
      alert('Failed to create script. Please try again.');
    } finally {
      setIsUploading(false);
      setShowTitleModal(false);
      setNewScriptTitle('');
    }
  }, [newScriptTitle, router]);

  const handleEditClick = useCallback((e: React.MouseEvent, script: ScriptSummary) => {
    e.stopPropagation(); // Prevent card click
    setEditingScriptId(script.script_id);
    setEditTitle(script.title);
    setEditWrittenBy("Written by");
    // Load author from description field (where it's stored in the backend)
    setEditAuthor(script.description || user?.displayName || user?.email || 'Writer');
  }, [user]);

  const handleSaveEdit = useCallback(async (scriptId: string) => {
    if (!editTitle.trim()) {
      setEditingScriptId(null);
      return;
    }

    // Store original values BEFORE optimistic update (fixes closure bug)
    const originalScript = scripts.find(s => s.script_id === scriptId);
    const originalTitle = originalScript?.title;
    const originalDescription = originalScript?.description;

    // Optimistic update: Update UI immediately for instant feedback
    const trimmedTitle = editTitle.trim();
    const trimmedAuthor = editAuthor.trim();
    setScripts(prev => prev.map(s =>
      s.script_id === scriptId
        ? { ...s, title: trimmedTitle, description: trimmedAuthor || null }
        : s
    ));
    setEditingScriptId(null);
    setEditError(null);

    // Then make API call in background
    // Store author name in description field since backend supports it
    try {
      await updateScript(scriptId, {
        title: trimmedTitle,
        description: trimmedAuthor || null
      });
    } catch (e: any) {
      // On error, revert to stored original values
      setScripts(prev => prev.map(s =>
        s.script_id === scriptId
          ? { ...s, title: originalTitle || trimmedTitle, description: originalDescription }
          : s
      ));
      setEditError(e?.message || "Failed to update script");
    }
  }, [editTitle, editAuthor, scripts]);

  const handleCancelEdit = useCallback(() => {
    // Batch state updates using React 18's automatic batching
    setEditingScriptId(null);
    setEditTitle("");
    setEditWrittenBy("Written by");
    setEditAuthor("");
  }, []);

  const handleDeleteClick = useCallback((e: React.MouseEvent, script: ScriptSummary) => {
    e.stopPropagation(); // Prevent card click
    setDeletingScript(script);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingScript) return;

    // Optimistic update: Remove from UI immediately for instant feedback
    const scriptToDelete = deletingScript;
    setScripts(prev => prev.filter(s => s.script_id !== scriptToDelete.script_id));
    setDeletingScript(null);
    setDeleteError(null);

    // Then make API call in background
    try {
      await deleteScript(scriptToDelete.script_id);
    } catch (e: any) {
      // On error, restore the deleted script
      setScripts(prev => [...prev, scriptToDelete].sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ));
      setDeleteError(e?.message || "Failed to delete script");
    }
  }, [deletingScript]);

  // Auth gating AFTER hooks to keep hook order stable
  if (authLoading) {
    return (
      <ProcessingScreen
        isVisible={true}
        message="Initializing WritersRoom"
        subtitle="preparing your creative workspace…"
      />
    );
  }
  if (!user) return <SignInPage />;

  // Render styled UI
  return (
    <>
      {/* Background layers */}
      <MoviePosterBanner />
      <div className="fixed inset-0 bg-white/85 backdrop-blur-sm z-0 pointer-events-none" />

      {/* Overlays */}
      <DragOverlay isVisible={isDragging} />
      <ProcessingScreen
        isVisible={isParsing}
        mode="upload"
      />

      {/* Top Navigation Bar */}
      <div className="fixed top-0 left-0 right-0 z-30 bg-white/70 backdrop-blur-md border-b border-slate-200/50">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between">
            {/* Branding */}
            <h1
              className="font-black text-white uppercase tracking-wider text-lg"
              style={{
                textShadow: '1.65px 1.65px 3.3px rgba(0, 0, 0, 0.5), 1.1px 1.1px 2.2px rgba(0, 0, 0, 0.44)'
              }}
            >
              WRITERSROOM
            </h1>

            {/* User Menu - Minimalist */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-slate-600">
                <div className="w-5 h-5 rounded-full border border-slate-600 flex items-center justify-center">
                  <User className="w-4 h-4" />
                </div>
                <span className="text-sm">{user.displayName || user.email}</span>
              </div>
              <button
                onClick={signOut}
                className="flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="text-sm">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error Toast - Fixed at top center, auto-dismissing with fade-out */}
      {currentError && (
        <div
          className={`fixed top-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 group ${
            errorFading
              ? 'opacity-0 scale-95 translate-y-[-8px]'
              : 'opacity-100 scale-100 animate-in fade-in slide-in-from-top-2 duration-300'
          }`}
        >
          <div className="bg-white/98 backdrop-blur-xl border border-slate-200/50 shadow-[0_8px_32px_rgba(0,0,0,0.12)] rounded-2xl px-8 py-4 max-w-md">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <div className="absolute inset-0 w-2 h-2 rounded-full bg-red-500/30 animate-ping" />
              </div>
              <p className="font-[family-name:var(--font-courier-prime)] text-base text-slate-900 tracking-tight flex-1">
                {currentError}
              </p>
              <button
                onClick={() => {
                  setUploadError(null);
                  setEditError(null);
                  setDeleteError(null);
                  setErrorFading(false);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-slate-100 rounded-lg"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4 text-slate-400 hover:text-slate-700" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="min-h-screen pt-12 p-6 relative z-10" onDrop={handleDrop}>
        <div className="max-w-7xl mx-auto">
          {/* Hidden file input - shared across all upload buttons */}
          <input type="file" accept=".fdx" onChange={handleFileSelect} className="hidden" id="fdx-upload" disabled={isUploading} />

          {/* Conditional Layout Based on Script Existence */}
          {!loadingScripts && scripts.length === 0 ? (
            /* Empty State - Hero Action Buttons Center Stage */
            <div className="min-h-screen flex items-center justify-center">
              <div className="max-w-4xl mx-auto w-full px-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Create New - Primary CTA */}
                  <button
                    onClick={createNewScript}
                    className="w-full px-12 py-16 bg-white/90 backdrop-blur-xl border-[1.5px] border-slate-300 rounded-2xl hover:bg-white hover:border-slate-400 transition-all duration-300 hover:scale-[1.02] shadow-2xl"
                  >
                    <Plus className="w-16 h-16 text-purple-600 mx-auto mb-6" />
                    <div className="text-2xl font-bold text-slate-900 mb-2">Start New Script</div>
                    <div className="text-slate-600">Create from scratch</div>
                  </button>

                  {/* Upload - Secondary CTA */}
                  <div className={`relative transition-all duration-300 ${isDragging ? 'scale-[1.02]' : ''}`}>
                    <button
                      onClick={() => document.getElementById('fdx-upload')?.click()}
                      disabled={isUploading}
                      className={`w-full px-12 py-16 bg-white/90 backdrop-blur-xl border-[1.5px] rounded-2xl transition-all duration-300 hover:scale-[1.02] shadow-2xl disabled:opacity-60 disabled:cursor-not-allowed ${isDragging ? 'border-blue-500 bg-blue-50/90 ring-4 ring-blue-500/30' : 'border-slate-300 hover:bg-white hover:border-slate-400'}`}
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
                </div>
              </div>
            </div>
          ) : loadingScripts ? (
            /* Loading State */
            <div className="min-h-[70vh] flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 border-4 border-slate-300/50 border-t-slate-700 rounded-full animate-spin mx-auto mb-6" />
                <p className="text-xl text-slate-700">Loading your scripts...</p>
              </div>
            </div>
          ) : (
            /* Has Scripts - Action Buttons Integrated into Grid */
            <div className="pt-8">
              <h2 className="text-2xl font-semibold text-slate-700 mb-8 tracking-wide">Your Projects</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Existing Scripts */}
                {scripts.map((p) => (
                  <Card
                    key={p.script_id}
                    className={`bg-white border-[1.5px] border-slate-300 shadow-xl transition-all duration-300 overflow-hidden group ${
                      editingScriptId === p.script_id
                        ? 'border-slate-400 scale-[1.02]'
                        : 'hover:border-slate-400 hover:shadow-2xl cursor-pointer hover:scale-[1.02]'
                    }`}
                    onClick={() => editingScriptId !== p.script_id && openProject(p.script_id)}
                  >
                    {/* Industry-Standard Screenplay Title Page */}
                    <div className="relative h-64 bg-white flex flex-col items-center justify-center p-8">
                      {/* Action Buttons - Subtle, Bottom-Right (hidden during edit) */}
                      {editingScriptId !== p.script_id && (
                        <div className="absolute bottom-1 right-3 z-10 flex gap-2">
                          <button
                            onClick={(e) => handleEditClick(e, p)}
                            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-40 hover:opacity-100 hover:scale-110 hover:bg-white/5 hover:backdrop-blur-sm hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.12)] transition-all duration-200 ease-in-out group/edit"
                            title="Edit title"
                          >
                            <Edit2 className="w-5 h-5 text-gray-500 group-hover/edit:text-black transition-colors duration-200 ease-in-out" />
                          </button>
                          <button
                            onClick={(e) => handleDeleteClick(e, p)}
                            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-40 hover:opacity-100 hover:scale-110 hover:bg-white/5 hover:backdrop-blur-sm hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.12)] transition-all duration-200 ease-in-out group/delete"
                            title="Delete script"
                          >
                            <Trash2 className="w-5 h-5 text-gray-500 group-hover/delete:text-black transition-colors duration-200 ease-in-out" />
                          </button>
                        </div>
                      )}

                      {/* Title - Uppercase, Centered, Underlined (or Editable) */}
                      {editingScriptId === p.script_id ? (
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(p.script_id);
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          maxLength={30}
                          className="font-[family-name:var(--font-courier-prime)] text-base font-normal text-center uppercase tracking-normal text-black underline decoration-1 underline-offset-2 bg-transparent border-none outline-none focus:outline-none w-full px-2"
                          autoFocus
                        />
                      ) : (
                        <h2 className="font-[family-name:var(--font-courier-prime)] text-base font-normal text-center uppercase tracking-normal text-black underline decoration-1 underline-offset-2">
                          {p.title}
                        </h2>
                      )}

                      {/* Blank lines (3 line breaks equivalent) */}
                      <div className="h-12" aria-hidden="true" />

                      {/* "Written by" - Editable in edit mode */}
                      {editingScriptId === p.script_id ? (
                        <input
                          type="text"
                          value={editWrittenBy}
                          onChange={(e) => setEditWrittenBy(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(p.script_id);
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          maxLength={30}
                          className="font-[family-name:var(--font-courier-prime)] text-base font-normal text-center text-black bg-transparent border-none outline-none focus:outline-none w-full px-2"
                        />
                      ) : (
                        <div className="font-[family-name:var(--font-courier-prime)] text-base font-normal text-center text-black">
                          Written by
                        </div>
                      )}

                      {/* Blank line (1 line break) */}
                      <div className="h-6" aria-hidden="true" />

                      {/* Author Name - Editable in edit mode */}
                      {editingScriptId === p.script_id ? (
                        <input
                          type="text"
                          value={editAuthor}
                          onChange={(e) => setEditAuthor(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(p.script_id);
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          maxLength={30}
                          className="font-[family-name:var(--font-courier-prime)] text-base font-normal text-center text-black bg-transparent border-none outline-none focus:outline-none w-full px-2"
                        />
                      ) : (
                        <div className="font-[family-name:var(--font-courier-prime)] text-base font-normal text-center text-black">
                          {p.description || user?.displayName || user?.email || 'Writer'}
                        </div>
                      )}

                      {/* Save/Cancel buttons - Identical position/styling to Edit/Delete */}
                      {editingScriptId === p.script_id && (
                        <div className="absolute bottom-1 right-3 z-10 flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveEdit(p.script_id);
                            }}
                            className="p-1.5 rounded-lg opacity-100 hover:opacity-100 hover:scale-110 hover:bg-white/5 hover:backdrop-blur-sm hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.12)] transition-all duration-200 ease-in-out"
                            disabled={!editTitle.trim()}
                            title="Save changes (Enter)"
                          >
                            <svg className="w-5 h-5 text-gray-500 hover:text-black transition-colors duration-200 ease-in-out" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelEdit();
                            }}
                            className="p-1.5 rounded-lg opacity-100 hover:opacity-100 hover:scale-110 hover:bg-white/5 hover:backdrop-blur-sm hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.12)] transition-all duration-200 ease-in-out"
                            title="Cancel editing (Escape)"
                          >
                            <svg className="w-5 h-5 text-gray-500 hover:text-black transition-colors duration-200 ease-in-out" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}

                {/* Create New Card - Integrated into Grid */}
                <Card className="border-[1.5px] border-slate-300 bg-white/80 backdrop-blur-md shadow-xl hover:bg-white/95 hover:border-slate-400 transition-all duration-300 cursor-pointer hover:scale-[1.02]">
                  <CardContent className="p-6 h-full flex items-center justify-center">
                    <button
                      onClick={createNewScript}
                      className="w-full h-full flex flex-col items-center justify-center space-y-4 py-8 hover:bg-transparent"
                    >
                      <div className="w-12 h-12 rounded-lg bg-purple-600/20 flex items-center justify-center">
                        <Plus className="w-6 h-6 text-purple-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">Start New Script</p>
                        <p className="text-xs text-slate-500">Create from scratch</p>
                      </div>
                    </button>
                  </CardContent>
                </Card>

                {/* Upload Card - Integrated into Grid */}
                <Card className={`border-[1.5px] border-dashed transition-all duration-300 cursor-pointer hover:scale-[1.02] ${isDragging ? 'border-blue-400 bg-blue-50/80 ring-4 ring-blue-400/30 shadow-xl' : 'border-slate-300 bg-white/80 hover:border-slate-400 hover:bg-white/95 shadow-xl'} backdrop-blur-md`}>
                  <CardContent className="p-6 h-full flex items-center justify-center">
                    <button
                      onClick={() => document.getElementById('fdx-upload')?.click()}
                      disabled={isUploading}
                      className="w-full h-full flex flex-col items-center justify-center space-y-4 py-8 hover:bg-transparent disabled:opacity-60"
                    >
                      {isUploading ? (
                        <>
                          <div className="w-12 h-12 border-2 border-blue-600/50 border-t-blue-600 rounded-full animate-spin" />
                          <div>
                            <p className="font-semibold text-slate-900 mb-1">Processing...</p>
                            <p className="text-xs text-slate-500">Importing screenplay</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-12 h-12 rounded-lg bg-blue-600/20 flex items-center justify-center">
                            <Upload className="w-6 h-6 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900">Upload Script</p>
                            <p className="text-xs text-slate-500">Drop FDX or click</p>
                          </div>
                        </>
                      )}
                    </button>
                  </CardContent>
                </Card>
              </div>

              {/* Shared with me section - only shows if user has shared scripts */}
              {sharedScripts.length > 0 && (
                <div className="pt-12">
                  <h2 className="text-2xl font-semibold text-slate-700 mb-8 tracking-wide">Shared with me</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sharedScripts.map((p) => (
                      <Card
                        key={p.script_id}
                        className="bg-white border-[1.5px] border-slate-300 shadow-xl transition-all duration-300 overflow-hidden group hover:border-slate-400 hover:shadow-2xl cursor-pointer hover:scale-[1.02]"
                        onClick={() => openProject(p.script_id)}
                      >
                        {/* Industry-Standard Screenplay Title Page - Same styling as owned scripts */}
                        <div className="relative h-64 bg-white flex flex-col items-center justify-center p-8">
                          {/* Title - Uppercase, Centered, Underlined */}
                          <h2 className="font-[family-name:var(--font-courier-prime)] text-base font-normal text-center uppercase tracking-normal text-black underline decoration-1 underline-offset-2">
                            {p.title}
                          </h2>

                          {/* Blank lines (3 line breaks equivalent) */}
                          <div className="h-12" aria-hidden="true" />

                          {/* "Written by" */}
                          <div className="font-[family-name:var(--font-courier-prime)] text-base font-normal text-center text-black">
                            Written by
                          </div>

                          {/* Blank line (1 line break) */}
                          <div className="h-6" aria-hidden="true" />

                          {/* Author Name */}
                          <div className="font-[family-name:var(--font-courier-prime)] text-base font-normal text-center text-black">
                            {p.description || 'Writer'}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Title Modal - Redesigned to match WritersRoom aesthetic */}
      <AnimatePresence>
        {showTitleModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-md flex items-center justify-center z-50"
            onClick={handleCancelModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="backdrop-blur-xl bg-white/60 dark:bg-slate-900/60 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] border border-white/30 dark:border-slate-700/30 p-12 max-w-lg w-full mx-4 relative"
              style={{
                fontFamily: 'var(--font-courier-prime), "Courier New", monospace'
              }}
            >
              {/* Close button */}
              <button
                onClick={handleCancelModal}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Icon with glow */}
              <div className="text-center mb-8 mt-6">
                <div className="flex justify-center mb-6">
                  <FileText
                    className="h-12 w-12 text-violet-400 drop-shadow-[0_0_10px_rgba(167,139,250,0.4)]"
                    strokeWidth={1.5}
                  />
                </div>

                {/* Title */}
                <h2 className="text-xl font-mono text-gray-800 dark:text-gray-100 tracking-wide mb-2">
                  Create New Script
                </h2>

                {/* Subtitle */}
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  What&apos;s the title of your masterpiece?
                </p>
              </div>

              {/* Input */}
              <div className="mb-8">
                <input
                  type="text"
                  value={newScriptTitle}
                  onChange={(e) => setNewScriptTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateScript();
                    if (e.key === 'Escape') handleCancelModal();
                  }}
                  placeholder="Enter script title..."
                  className="w-full px-4 py-3 rounded-lg border border-violet-300/50 bg-white/70 dark:bg-slate-800/50 focus:ring-2 focus:ring-violet-400 focus:border-violet-400 font-mono text-gray-700 dark:text-gray-100 placeholder:text-gray-400 transition-all shadow-inner"
                  autoFocus
                />
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleCancelModal}
                  className="flex-1 px-5 py-2.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-mono tracking-wide transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateScript}
                  disabled={!newScriptTitle.trim()}
                  className="flex-1 px-5 py-2.5 rounded-lg bg-violet-500/90 hover:bg-violet-500 text-white font-mono tracking-wide shadow-[0_0_10px_rgba(167,139,250,0.3)] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                >
                  Create Script
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal - Cinematic WritersRoom Style */}
      {deletingScript && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-md flex items-center justify-center z-50 animate-in fade-in duration-200"
          onClick={() => setDeletingScript(null)}
        >
          <div
            className="bg-[#ffffff]/95 backdrop-blur-sm border border-gray-200/40 rounded-3xl shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3)] px-10 py-8 max-w-xl w-full mx-4 animate-in zoom-in-95 fade-in duration-200 ease-out"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setDeletingScript(null)}
              className="absolute top-5 right-5 p-1.5 text-gray-400 hover:text-gray-900 transition-colors duration-200"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Icon and Title */}
            <div className="flex items-start gap-4 mb-5">
              <Trash2 className="w-6 h-6 text-gray-400 opacity-50 hover:opacity-80 transition-opacity mt-1" />
              <div className="flex-1">
                <h2 className="font-[family-name:var(--font-courier-prime)] text-3xl font-normal text-[#111] mb-2">
                  Delete Script?
                </h2>
                <p className="font-[family-name:var(--font-courier-prime)] text-xl text-[#555] mb-3">
                  &quot;{deletingScript.title}&quot;
                </p>
                <p className="text-base text-gray-500 italic font-light">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-4 mt-8">
              <button
                onClick={() => setDeletingScript(null)}
                className="flex-1 px-5 py-3 text-base font-medium text-gray-700 bg-transparent border border-gray-300/50 rounded-xl hover:bg-gray-100/60 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-5 py-3 text-base font-bold text-white bg-red-500/80 hover:bg-red-500 rounded-xl shadow-sm hover:shadow-md transition-all duration-200"
              >
                Delete Script
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
