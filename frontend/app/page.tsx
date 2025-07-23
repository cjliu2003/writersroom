"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, PlusCircle } from "lucide-react"
import { useRouter } from "next/navigation"

export default function HomePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLogin, setIsLogin] = useState(true)
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

  const startNewScript = () => {
    const newScript = {
      id: Date.now().toString(),
      title: "Untitled Screenplay",
      scenes: [],
      content: "",
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem("current-script", JSON.stringify(newScript))
    router.push("/editor")
  }

  const importScript = () => {
    // For demo purposes, create a sample script
    const sampleScript = {
      id: Date.now().toString(),
      title: "Sample Screenplay",
      scenes: [
        {
          id: "1",
          heading: "INT. COFFEE SHOP - DAY",
          content: "A bustling coffee shop filled with the morning crowd.",
        },
      ],
      content: `FADE IN:

INT. COFFEE SHOP - DAY

A bustling coffee shop filled with the morning crowd. Steam rises from espresso machines as SARAH (28), a determined journalist, sits at a corner table with her laptop.

SARAH
(typing furiously)
This story is going to change everything.

The bell above the door CHIMES. MARCUS (35), mysterious and well-dressed, enters and scans the room.

MARCUS
(approaching Sarah's table)
Mind if I sit? All the other tables are taken.

Sarah looks up, suspicious but intrigued.

SARAH
Sure, but I'm working on something important.

MARCUS
(sitting down)
Aren't we all?

FADE OUT.`,
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem("current-script", JSON.stringify(sampleScript))
    router.push("/editor")
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">AI Screenwriter Studio</CardTitle>
            <CardDescription>Professional screenwriting meets AI assistance</CardDescription>
          </CardHeader>
          <CardContent>
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">WritersRoom</h1>
          <p className="text-xl text-gray-600">Write professional screenplays with AI assistance</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={startNewScript}>
            <CardHeader className="text-center">
              <PlusCircle className="w-12 h-12 mx-auto mb-4 text-blue-600" />
              <CardTitle>Start New Script</CardTitle>
              <CardDescription>Begin writing a new screenplay with AI-powered assistance</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full">Create New Screenplay</Button>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={importScript}>
            <CardHeader className="text-center">
              <Upload className="w-12 h-12 mx-auto mb-4 text-green-600" />
              <CardTitle>Import Script</CardTitle>
              <CardDescription>Import an existing screenplay or try our sample script</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full bg-transparent">
                Import or Try Sample
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center">
          <Button
            variant="ghost"
            onClick={() => {
              localStorage.removeItem("screenwriter-auth")
              setIsAuthenticated(false)
            }}
          >
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  )
}