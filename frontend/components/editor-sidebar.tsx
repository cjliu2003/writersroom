"use client"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { FileText, Film } from "lucide-react"

interface Scene {
  id: string
  heading: string
  content: string
}

interface EditorSidebarProps {
  scenes: Scene[]
  currentScene: string
  onSceneSelect: (sceneId: string) => void
}

export function EditorSidebar({ scenes, currentScene, onSceneSelect }: EditorSidebarProps) {
  return (
    <Sidebar className="w-64">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <Film className="w-6 h-6 text-blue-600" />
          <span className="font-semibold">Scene Navigator</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Scenes ({scenes.length})</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {scenes.length === 0 ? (
                <div className="p-4 text-sm text-gray-500 text-center">
                  No scenes detected yet.
                  <br />
                  Start writing with scene headings like:
                  <br />
                  <code className="text-xs bg-gray-100 px-1 rounded">INT. COFFEE SHOP - DAY</code>
                </div>
              ) : (
                scenes.map((scene, index) => (
                  <SidebarMenuItem key={scene.id}>
                    <SidebarMenuButton
                      onClick={() => onSceneSelect(scene.id)}
                      isActive={currentScene === scene.id}
                      className="text-left"
                    >
                      <FileText className="w-4 h-4" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-500">Scene {index + 1}</div>
                        <div className="text-sm font-medium truncate">{scene.heading}</div>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
