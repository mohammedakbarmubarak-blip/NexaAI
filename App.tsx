import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Conversation,
  Project,
  UserSettings,
  AttachedFile,
  Message,
  MessageFeedback,
  UserProfile,
} from './types';
import { storageService, DEFAULT_SETTINGS } from './services/storageService';
import { aiService } from './services/aiService';
import { AI_MODELS, DEFAULT_MODEL_ID } from './constants/models';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { ChatArea } from './components/chat/ChatArea';
import { SearchModal } from './components/modals/SearchModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { ProjectModal } from './components/modals/ProjectModal';
import { ShareModal } from './components/modals/ShareModal';
import { AuthModal } from './components/modals/AuthModal';
import { FeedbackModal } from './components/modals/FeedbackModal';
import { ShortcutsModal } from './components/modals/ShortcutsModal';

export default function App() {
  // Persistence state
  const [settings, setSettings] = useState<UserSettings>(() => storageService.getSettings());
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    storageService.getConversations()
  );
  const [projects, setProjects] = useState<Project[]>(() => storageService.getProjects());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    const saved = storageService.getCurrentConversationId();
    const initialList = storageService.getConversations();
    if (saved && initialList.some((c) => c.id === saved)) return saved;
    return initialList[0]?.id || null;
  });

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string>(
    settings.defaultModel || DEFAULT_MODEL_ID
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);

  // Modals state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [sharedMessage, setSharedMessage] = useState<Message | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedbackTargetMessageId, setFeedbackTargetMessageId] = useState<string>('');
  const [feedbackType, setFeedbackType] = useState<'like' | 'dislike'>('like');
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Active conversation object
  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [conversations, activeConversationId]);

  // Active project object
  const activeProject = useMemo(() => {
    if (activeConversation?.projectId) {
      return projects.find((p) => p.id === activeConversation.projectId) || null;
    }
    if (activeProjectId) {
      return projects.find((p) => p.id === activeProjectId) || null;
    }
    return null;
  }, [projects, activeConversation, activeProjectId]);

  // Sync model with active conversation if set
  useEffect(() => {
    if (activeConversation?.modelId) {
      setCurrentModelId(activeConversation.modelId);
    }
  }, [activeConversationId]);

  // Handle Theme (dark/light/system)
  useEffect(() => {
    const root = document.documentElement;
    const isDark =
      settings.theme === 'dark' ||
      (settings.theme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  // Save changes to storage
  useEffect(() => {
    storageService.saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    storageService.saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    storageService.saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    storageService.setCurrentConversationId(activeConversationId);
  }, [activeConversationId]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      if (isMeta && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      } else if (isMeta && e.key === 'n') {
        e.preventDefault();
        handleNewChat(activeProjectId || undefined);
      } else if (isMeta && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsSearchOpen(false);
        setIsSettingsOpen(false);
        setIsProjectModalOpen(false);
        setIsShareModalOpen(false);
        setIsAuthModalOpen(false);
        setIsFeedbackModalOpen(false);
        setIsShortcutsOpen(false);
        setIsMobileDrawerOpen(false);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeProjectId]);

  // Create new conversation
  const handleNewChat = (projectId?: string) => {
    const newConv: Conversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      modelId: currentModelId,
      isPinned: false,
      isArchived: false,
      projectId: projectId || activeProjectId || null,
    };

    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
    setIsMobileDrawerOpen(false);
  };

  // Send message & stream response
  const handleSendMessage = async (
    content: string,
    files: AttachedFile[],
    modelId: string
  ) => {
    let targetConv = activeConversation;
    const userTimestamp = Date.now();

    const userMsg: Message = {
      id: `msg_u_${userTimestamp}`,
      role: 'user',
      content,
      timestamp: userTimestamp,
      attachedFiles: files,
      tokenCount: aiService.estimateTokenCount(content),
    };

    // If no active conversation exists, create one immediately
    if (!targetConv) {
      const newTitle = content.length > 36 ? `${content.slice(0, 36)}...` : content;
      const newConv: Conversation = {
        id: `conv_${userTimestamp}_${Math.random().toString(36).substring(2, 6)}`,
        title: newTitle || 'New Conversation',
        createdAt: userTimestamp,
        updatedAt: userTimestamp,
        messages: [userMsg],
        modelId,
        isPinned: false,
        isArchived: false,
        projectId: activeProjectId || null,
      };

      setConversations((prev) => [newConv, ...prev]);
      setActiveConversationId(newConv.id);
      targetConv = newConv;
    } else {
      // If first message in existing empty conversation, update title
      const isFirst = targetConv.messages.length === 0;
      const updatedTitle = isFirst
        ? content.length > 36
          ? `${content.slice(0, 36)}...`
          : content
        : targetConv.title;

      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetConv!.id
            ? {
                ...c,
                title: updatedTitle,
                updatedAt: userTimestamp,
                modelId,
                messages: [...c.messages, userMsg],
              }
            : c
        )
      );
    }

    // Prepare Assistant Turn Placeholder
    const assistantTimestamp = Date.now();
    const assistantMsgId = `msg_a_${assistantTimestamp}`;
    const startTime = performance.now();

    const initialAssistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: assistantTimestamp,
      modelId,
      isStreaming: true,
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === targetConv!.id
          ? {
              ...c,
              messages: [...c.messages, userMsg, initialAssistantMsg],
            }
          : c
      )
    );

    setIsStreaming(true);

    // Abort controller for cancellation
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Build system instructions with project context
    let combinedInstructions = settings.customSystemInstructions || '';
    if (activeProject?.customInstructions) {
      combinedInstructions += `\n[Project Guidelines: ${activeProject.title}]\n${activeProject.customInstructions}`;
    }

    try {
      const messagesHistory = [
        ...(targetConv?.messages || []),
        userMsg,
      ].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const finalResponse = await aiService.streamChat({
        messages: messagesHistory,
        model: modelId,
        systemInstruction: combinedInstructions,
        temperature: settings.temperature,
        attachedFiles: files,
        signal: controller.signal,
        onChunk: (chunkText) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === targetConv!.id
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantMsgId
                        ? { ...m, content: chunkText, isStreaming: true }
                        : m
                    ),
                  }
                : c
            )
          );
        },
      });

      const elapsedMs = Math.round(performance.now() - startTime);
      const finalTokens = aiService.estimateTokenCount(finalResponse);

      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetConv!.id
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: finalResponse,
                        isStreaming: false,
                        tokenCount: finalTokens,
                        generationDurationMs: elapsedMs,
                      }
                    : m
                ),
              }
            : c
        )
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConv!.id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          isStreaming: false,
                          error: err?.message || 'Failed to generate response',
                        }
                      : m
                  ),
                }
              : c
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // Stop streaming
  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    // Mark streaming false on messages
    if (activeConversationId) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConversationId
            ? {
                ...c,
                messages: c.messages.map((m) => ({ ...m, isStreaming: false })),
              }
            : c
        )
      );
    }
  };

  // Edit user message and re-run
  const handleEditMessage = (messageId: string, newContent: string) => {
    if (!activeConversation) return;
    const msgIndex = activeConversation.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    // Truncate messages up to this point
    const updatedMessages = activeConversation.messages.slice(0, msgIndex);
    const editedUserMsg: Message = {
      ...activeConversation.messages[msgIndex],
      content: newContent,
      isEdited: true,
      timestamp: Date.now(),
    };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversation.id
          ? {
              ...c,
              messages: [...updatedMessages, editedUserMsg],
            }
          : c
      )
    );

    // Trigger regeneration from this turn
    handleSendMessage(newContent, editedUserMsg.attachedFiles || [], currentModelId);
  };

  // Regenerate assistant response
  const handleRegenerateResponse = (messageId: string, modelId?: string) => {
    if (!activeConversation) return;
    const msgIndex = activeConversation.messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    // Find the user prompt preceding this response
    const userMsg = activeConversation.messages[msgIndex - 1];
    if (!userMsg || userMsg.role !== 'user') return;

    // Trim messages to before this assistant message
    const trimmedMessages = activeConversation.messages.slice(0, msgIndex);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversation.id
          ? { ...c, messages: trimmedMessages }
          : c
      )
    );

    handleSendMessage(
      userMsg.content,
      userMsg.attachedFiles || [],
      modelId || currentModelId
    );
  };

  // Feedback modal
  const handleOpenFeedback = (messageId: string, type: 'like' | 'dislike') => {
    setFeedbackTargetMessageId(messageId);
    setFeedbackType(type);
    setIsFeedbackModalOpen(true);
  };

  const handleSubmitFeedback = (feedback: MessageFeedback) => {
    if (!activeConversationId || !feedbackTargetMessageId) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversationId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === feedbackTargetMessageId ? { ...m, feedback } : m
              ),
            }
          : c
      )
    );
  };

  // Rename conversation
  const handleRenameConversation = (id: string, newTitle: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle, updatedAt: Date.now() } : c))
    );
  };

  // Pin conversation
  const handlePinConversation = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isPinned: !c.isPinned } : c))
    );
  };

  // Delete conversation
  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      setActiveConversationId(remaining[0]?.id || null);
    }
  };

  // Duplicate conversation
  const handleDuplicateConversation = (id: string) => {
    const target = conversations.find((c) => c.id === id);
    if (!target) return;

    const dup: Conversation = {
      ...target,
      id: `conv_${Date.now()}_dup`,
      title: `${target.title} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [...target.messages.map((m) => ({ ...m, id: `msg_${Date.now()}_${Math.random()}` }))],
    };

    setConversations((prev) => [dup, ...prev]);
    setActiveConversationId(dup.id);
  };

  // Move to Project
  const handleMoveToProject = (conversationId: string, projectId: string | null) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, projectId } : c))
    );
  };

  // Projects CRUD
  const handleSaveProject = (projectData: Partial<Project>) => {
    if (projectData.id) {
      // Edit existing
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectData.id
            ? ({ ...p, ...projectData, updatedAt: Date.now() } as Project)
            : p
        )
      );
    } else {
      // Create new
      const newProj: Project = {
        id: `proj_${Date.now()}`,
        title: projectData.title || 'Untitled Project',
        description: projectData.description || '',
        color: projectData.color || '#3b82f6',
        customInstructions: projectData.customInstructions || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        conversationIds: [],
        files: projectData.files || [],
      };
      setProjects((prev) => [newProj, ...prev]);
    }
  };

  const handleDeleteProject = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    // Remove project reference from chats
    setConversations((prev) =>
      prev.map((c) => (c.projectId === projectId ? { ...c, projectId: null } : c))
    );
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
    }
  };

  // Clear current chat
  const handleClearCurrentChat = () => {
    if (!activeConversation) return;
    if (window.confirm('Clear all messages from this conversation?')) {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversation.id ? { ...c, messages: [] } : c))
      );
    }
  };

  // Clear all history
  const handleClearAllHistory = () => {
    storageService.clearAllHistory();
    setConversations([]);
    setActiveConversationId(null);
  };

  // Export full JSON backup
  const handleExportAll = () => {
    const jsonStr = storageService.exportAllData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexa_ai_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON backup
  const handleImportBackup = (jsonStr: string): boolean => {
    const success = storageService.importData(jsonStr);
    if (success) {
      setSettings(storageService.getSettings());
      setConversations(storageService.getConversations());
      setProjects(storageService.getProjects());
    }
    return success;
  };

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden bg-[#0f1115] text-[#e1e1e1] font-sans antialiased ${
        settings.fontSize === 'sm'
          ? 'text-xs'
          : settings.fontSize === 'lg'
          ? 'text-base'
          : 'text-sm'
      }`}
    >
      {/* Desktop Left Sidebar */}
      <div className="hidden md:flex h-full shrink-0">
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          projects={projects}
          activeProjectId={activeProjectId}
          userProfile={settings.userProfile}
          isOpen={sidebarOpen}
          onToggleOpen={() => setSidebarOpen(!sidebarOpen)}
          onSelectConversation={(id) => setActiveConversationId(id)}
          onNewChat={handleNewChat}
          onOpenSearch={() => setIsSearchOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
          onOpenProfile={() => setIsAuthModalOpen(true)}
          onOpenNewProject={() => {
            setEditingProject(null);
            setIsProjectModalOpen(true);
          }}
          onSelectProject={(pId) => setActiveProjectId(pId)}
          onRenameConversation={handleRenameConversation}
          onPinConversation={handlePinConversation}
          onDeleteConversation={handleDeleteConversation}
          onDuplicateConversation={handleDuplicateConversation}
          onMoveToProject={handleMoveToProject}
        />
      </div>

      {/* Mobile Slide-Out Drawer */}
      {isMobileDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex md:hidden bg-black/70 backdrop-blur-xs transition-opacity"
          onClick={() => setIsMobileDrawerOpen(false)}
        >
          <div
            className="w-4/5 max-w-xs h-full bg-[#181a1f] border-r border-[#26282c] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar
              conversations={conversations}
              activeConversationId={activeConversationId}
              projects={projects}
              activeProjectId={activeProjectId}
              userProfile={settings.userProfile}
              isOpen={true}
              onToggleOpen={() => setIsMobileDrawerOpen(false)}
              onSelectConversation={(id) => {
                setActiveConversationId(id);
                setIsMobileDrawerOpen(false);
              }}
              onNewChat={handleNewChat}
              onOpenSearch={() => {
                setIsMobileDrawerOpen(false);
                setIsSearchOpen(true);
              }}
              onOpenSettings={() => {
                setIsMobileDrawerOpen(false);
                setIsSettingsOpen(true);
              }}
              onOpenShortcuts={() => {
                setIsMobileDrawerOpen(false);
                setIsShortcutsOpen(true);
              }}
              onOpenProfile={() => {
                setIsMobileDrawerOpen(false);
                setIsAuthModalOpen(true);
              }}
              onOpenNewProject={() => {
                setIsMobileDrawerOpen(false);
                setEditingProject(null);
                setIsProjectModalOpen(true);
              }}
              onSelectProject={(pId) => {
                setActiveProjectId(pId);
                setIsMobileDrawerOpen(false);
              }}
              onRenameConversation={handleRenameConversation}
              onPinConversation={handlePinConversation}
              onDeleteConversation={handleDeleteConversation}
              onDuplicateConversation={handleDuplicateConversation}
              onMoveToProject={handleMoveToProject}
              isMobile
            />
          </div>
        </div>
      )}

      {/* Main Workspace Area */}
      <div className="flex flex-1 flex-col h-full overflow-hidden">
        {/* Top Bar */}
        <TopBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => {
            if (window.innerWidth < 768) {
              setIsMobileDrawerOpen(true);
            } else {
              setSidebarOpen(!sidebarOpen);
            }
          }}
          title={activeConversation?.title || 'New Chat'}
          onRenameTitle={(newTitle) => {
            if (activeConversationId) {
              handleRenameConversation(activeConversationId, newTitle);
            }
          }}
          currentModelId={currentModelId}
          onSelectModel={(mId) => {
            setCurrentModelId(mId);
            if (activeConversationId) {
              setConversations((prev) =>
                prev.map((c) => (c.id === activeConversationId ? { ...c, modelId: mId } : c))
              );
            }
          }}
          theme={settings.theme}
          onToggleTheme={() =>
            setSettings((prev) => ({
              ...prev,
              theme: prev.theme === 'dark' ? 'light' : 'dark',
            }))
          }
          onOpenShareModal={() => {
            setSharedMessage(null);
            setIsShareModalOpen(true);
          }}
          onClearChat={handleClearCurrentChat}
          onOpenSettings={() => setIsSettingsOpen(true)}
          activeProject={activeProject}
          messageCount={activeConversation?.messages.length || 0}
        />

        {/* Chat Area */}
        <ChatArea
          conversation={activeConversation}
          activeProject={activeProject}
          userName={settings.userProfile.name}
          isStreaming={isStreaming}
          onSendMessage={handleSendMessage}
          onStopStreaming={handleStopStreaming}
          onEditMessage={handleEditMessage}
          onRegenerateResponse={handleRegenerateResponse}
          onMessageFeedback={handleOpenFeedback}
          onShareMessage={(msg) => {
            setSharedMessage(msg);
            setIsShareModalOpen(true);
          }}
          currentModelId={currentModelId}
          onModelChange={setCurrentModelId}
          showTimestamps={settings.showTimestamps}
        />
      </div>

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        conversations={conversations}
        projects={projects}
        onSelectConversation={(id) => {
          setActiveConversationId(id);
          setIsSearchOpen(false);
        }}
        onSelectProject={(pId) => {
          setActiveProjectId(pId);
          setIsSearchOpen(false);
        }}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={(newVals) => setSettings((prev) => ({ ...prev, ...newVals }))}
        onExportAll={handleExportAll}
        onImportBackup={handleImportBackup}
        onClearAllHistory={handleClearAllHistory}
      />

      {/* Project Modal */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        project={editingProject}
        onSaveProject={handleSaveProject}
        onDeleteProject={handleDeleteProject}
      />

      {/* Share / Export Modal */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        conversation={activeConversation}
        singleMessage={sharedMessage}
      />

      {/* User / Auth Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={settings.userProfile}
        onSelectUser={(uProfile) =>
          setSettings((prev) => ({ ...prev, userProfile: uProfile }))
        }
      />

      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={isFeedbackModalOpen}
        onClose={() => setIsFeedbackModalOpen(false)}
        messageId={feedbackTargetMessageId}
        type={feedbackType}
        onSubmitFeedback={handleSubmitFeedback}
      />

      {/* Keyboard Shortcuts Modal */}
      <ShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
}
