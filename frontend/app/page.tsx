"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Search, SlidersHorizontal, Plus, FileText, Folder, MessageSquare, Star, Trash2, User } from "lucide-react"
import { useRouter } from "next/navigation"

interface Project {
  id: string
  title: string
  lastEdited: string
  pages: number
  folders: number
  chats: number
  starred: boolean
}

export default function HomePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLogin, setIsLogin] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newProjectTitle, setNewProjectTitle] = useState("Untitled Script")
  const [newProjectDescription, setNewProjectDescription] = useState("In a galaxy far, far away...")
  const [searchQuery, setSearchQuery] = useState("")
  const [projects, setProjects] = useState<Project[]>([
    {
      id: "1",
      title: "Silk_Road_v2",
      lastEdited: "2 days ago",
      pages: 120,
      folders: 6,
      chats: 9,
      starred: false,
    },
    {
      id: "2",
      title: "The Last Stand",
      lastEdited: "5 days ago",
      pages: 17,
      folders: 2,
      chats: 3,
      starred: false,
    },
    {
      id: "3",
      title: "Echoes of Tomorrow",
      lastEdited: "2 weeks ago",
      pages: 24,
      folders: 6,
      chats: 2,
      starred: false,
    },
    {
      id: "4",
      title: "Sunset Downtown",
      lastEdited: "3 weeks ago",
      pages: 6,
      folders: 1,
      chats: 2,
      starred: false,
    },
    {
      id: "5",
      title: "The Grandma 4",
      lastEdited: "2 years ago",
      pages: 67,
      folders: 4,
      chats: 5,
      starred: false,
    },
  ])
  const router = useRouter()

  useEffect(() => {
    const auth = localStorage.getItem("screenwriter-auth")
    if (auth) {
      setIsAuthenticated(true)
    }
  }, [])

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault()
    if (email && password) {
      localStorage.setItem("screenwriter-auth", JSON.stringify({ email }))
      setIsAuthenticated(true)
    }
  }

  const handleCreateProject = () => {
    const newProject = {
      id: Date.now().toString(),
      title: newProjectTitle,
      scenes: [],
      content: "",
      description: newProjectDescription,
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem("current-script", JSON.stringify(newProject))
    router.push("/editor")
  }

  const openProject = (projectId: string) => {
    // For demo purposes, create a sample script based on project
    const project = projects.find((p) => p.id === projectId)
    if (!project) return

    const sampleScript = {
      id: projectId,
      title: project.title,
      scenes: [
        {
          id: "1",
          heading: "EXT. GRASSY FIELD - BASE REALITY - DAY - MEMORY",
          content: "A young Ella (6, carefree) runs through a yard. A home-video. A memory.",
        },
      ],
      content: `EXT. GRASSY FIELD - BASE REALITY - DAY - MEMORY

A young Ella (6, carefree) runs through a yard. A home-video. A memory.

                    SAM (V.O.)
          Hey Atlas...

The girl stops. Picks a flower. Smells it.

                    SAM (V.O.)
          Do you believe in God?

                                        CUT TO:

EXT. CLIFFSIDE OCEAN VIEW - RECURSE - DAY

A girl stands center frame. Black hoodie. Hood up. She overlooks the ocean. In one hand: a small flower. The one from before. In the other: an iPad, hidden behind her back.

                    ATLAS (V.O.)
          I do...

After a moment, she drops the flower. Brings the iPad forward. Taps the screen.

The world shifts. To night. To sunset. She's still. The world warping around her. She hesitates.

                    SAM (V.O.)
          You think God can see us in here?

She taps again. The world turns anime. Then black and white.

                    ELLA
                    (beat)
          Reset.

The world dissolves — replaced by a glowing grid stretching to the horizon. A blueprint of something not yet built.

                    ELLA (CONT'D)
          Hmm.

                                        CUT TO:

INT. SAM'S APARTMENT - BASE REALITY - DAY

Over the shoulder shot of Sam holding his infant son. Applying a cream to thin scars on his son's scalp...`,
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem("current-script", JSON.stringify(sampleScript))
    router.push("/editor")
  }

  const toggleStar = (projectId: string) => {
    setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, starred: !p.starred } : p)))
  }

  const deleteProject = (projectId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projectId))
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold">WritersRoom</h1>
              <p className="text-gray-600">Professional screenwriting meets AI assistance</p>
            </div>
            <form onSubmit={handleAuth} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
              </div>
              <Button type="submit" className="w-full">
                {isLogin ? "Sign In" : "Sign Up"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setIsLogin(!isLogin)}>
                {isLogin ? "Need an account? Sign up" : "Already have an account? Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  const filteredProjects = projects.filter((project) => project.title.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">My Scripts</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">Not Signed In</span>
            <Button variant="ghost" size="sm">
              <User className="w-4 h-4 mr-2" />
              Sign In
            </Button>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search Scripts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-80"
              />
            </div>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Sort
            </Button>
          </div>
          <Button onClick={() => setShowCreateModal(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2" />
            New Script
          </Button>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="px-6 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProjects.map((project) => (
            <Card key={project.id} className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-4">
                <div onClick={() => openProject(project.id)}>
                  <h3 className="font-semibold text-lg mb-2">{project.title}</h3>
                  <p className="text-sm text-gray-600 mb-4">Last edited {project.lastEdited}</p>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <FileText className="w-4 h-4" />
                      <span>{project.pages} pages</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Folder className="w-4 h-4" />
                      <span>{project.folders} folders</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <MessageSquare className="w-4 h-4" />
                      <span>{project.chats} chats</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleStar(project.id)
                    }}
                  >
                    <Star
                      className={`w-4 h-4 ${project.starred ? "fill-yellow-400 text-yellow-400" : "text-gray-400"}`}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteProject(project.id)
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-gray-400" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* New Project Card */}
          <Card
            className="border-2 border-dashed border-blue-300 hover:border-blue-400 transition-colors cursor-pointer"
            onClick={() => setShowCreateModal(true)}
          >
            <CardContent className="p-4 flex flex-col items-center justify-center h-full min-h-[200px]">
              <div className="w-12 h-12 rounded-full border-2 border-dashed border-blue-400 flex items-center justify-center mb-4">
                <Plus className="w-6 h-6 text-blue-600" />
              </div>
              <span className="text-blue-600 font-medium">New Script</span>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create New Script Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">Create New Script</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Project Title</Label>
              <Input
                id="title"
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                placeholder="Untitled Script"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Project Description</Label>
              <Textarea
                id="description"
                value={newProjectDescription}
                onChange={(e) => setNewProjectDescription(e.target.value)}
                placeholder="In a galaxy far, far away..."
                rows={3}
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button onClick={handleCreateProject} className="flex-1 bg-blue-600 hover:bg-blue-700">
                Create
              </Button>
              <Button variant="outline" onClick={() => setShowCreateModal(false)} className="flex-1">
                Back
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
