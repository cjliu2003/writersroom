"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronLeft, ChevronRight, MoreHorizontal, Trash2, Plus } from "lucide-react"

interface Character {
  id: string
  name: string
}

interface CharacterSidebarProps {
  characters: Character[]
  onAddCharacter: (name: string) => void
  onDeleteCharacter: (id: string) => void
}

export function CharacterSidebar({ characters, onAddCharacter, onDeleteCharacter }: CharacterSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [newCharacterName, setNewCharacterName] = useState("")
  const [showAddInput, setShowAddInput] = useState(false)

  const handleAddCharacter = () => {
    if (newCharacterName.trim()) {
      onAddCharacter(newCharacterName.trim())
      setNewCharacterName("")
      setShowAddInput(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddCharacter()
    } else if (e.key === "Escape") {
      setShowAddInput(false)
      setNewCharacterName("")
    }
  }

  if (isCollapsed) {
    return (
      <div className="w-12 border-r bg-gray-50 flex flex-col items-center py-4">
        <Button variant="ghost" size="sm" onClick={() => setIsCollapsed(false)} className="mb-4">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="w-80 border-r bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b bg-white flex items-center justify-between">
        <h3 className="font-semibold">Character Development</h3>
        <Button variant="ghost" size="sm" onClick={() => setIsCollapsed(true)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
      </div>

      {/* Characters List */}
      <div className="flex-1 p-4">
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Characters</h4>

          {characters.map((character) => (
            <div key={character.id} className="flex items-center justify-between p-3 bg-white rounded-lg border">
              <span className="font-medium">{character.name}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDeleteCharacter(character.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          {/* Add Character */}
          {showAddInput ? (
            <div className="p-3 bg-white rounded-lg border border-blue-200">
              <Input
                value={newCharacterName}
                onChange={(e) => setNewCharacterName(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Character name..."
                className="mb-2"
                autoFocus
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddCharacter}>
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddInput(false)
                    setNewCharacterName("")
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 bg-transparent"
              onClick={() => setShowAddInput(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          )}
        </div>
      </div>

      {/* Bottom Add Button */}
      <div className="p-4 border-t bg-white">
        <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => setShowAddInput(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Item
        </Button>
      </div>
    </div>
  )
}
