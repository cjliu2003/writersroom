"use client"

import { useEffect, useRef, useState } from 'react'

interface UseIntersectionObserverOptions {
  threshold?: number | number[]
  rootMargin?: string
  enabled?: boolean
}

interface IntersectionData {
  isIntersecting: boolean
  intersectionRatio: number
  target: Element
}

export function useIntersectionObserver<T extends Element>(
  options: UseIntersectionObserverOptions = {}
) {
  const [entries, setEntries] = useState<Map<Element, IntersectionData>>(new Map())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const elementsRef = useRef<Set<T>>(new Set())
  
  const {
    threshold = [0.1, 0.3, 0.5, 0.7],
    rootMargin = '-10% 0px -10% 0px',
    enabled = true
  } = options
  
  useEffect(() => {
    if (!enabled) return
    
    const observer = new IntersectionObserver(
      (observerEntries) => {
        setEntries(prev => {
          const newEntries = new Map(prev)
          
          observerEntries.forEach(entry => {
            newEntries.set(entry.target, {
              isIntersecting: entry.isIntersecting,
              intersectionRatio: entry.intersectionRatio,
              target: entry.target
            })
          })
          
          return newEntries
        })
      },
      { threshold, rootMargin }
    )
    
    observerRef.current = observer
    
    // Observe all currently tracked elements
    elementsRef.current.forEach(element => {
      observer.observe(element)
    })
    
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [threshold, rootMargin, enabled])
  
  const observe = (element: T | null) => {
    if (!element || !observerRef.current) return
    
    elementsRef.current.add(element)
    observerRef.current.observe(element)
  }
  
  const unobserve = (element: T | null) => {
    if (!element || !observerRef.current) return
    
    elementsRef.current.delete(element)
    observerRef.current.unobserve(element)
    setEntries(prev => {
      const newEntries = new Map(prev)
      newEntries.delete(element)
      return newEntries
    })
  }
  
  const disconnect = () => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      elementsRef.current.clear()
      setEntries(new Map())
    }
  }
  
  return {
    entries,
    observe,
    unobserve,
    disconnect
  }
}

export function useMostVisibleElement<T extends Element>(
  entries: Map<Element, IntersectionData>
) {
  const [mostVisible, setMostVisible] = useState<{
    element: Element | null
    ratio: number
    data?: any
  }>({ element: null, ratio: 0 })
  
  useEffect(() => {
    let maxRatio = 0
    let mostVisibleElement: Element | null = null
    let elementData: any = null
    
    entries.forEach((data, element) => {
      if (data.isIntersecting && data.intersectionRatio > maxRatio) {
        maxRatio = data.intersectionRatio
        mostVisibleElement = element
        
        // Extract data attributes
        const pageAttr = element.getAttribute('data-page')
        const scenesAttr = element.getAttribute('data-scenes')
        
        elementData = {
          page: pageAttr ? parseInt(pageAttr) : null,
          scenes: scenesAttr ? JSON.parse(scenesAttr) : []
        }
      }
    })
    
    setMostVisible({
      element: mostVisibleElement,
      ratio: maxRatio,
      data: elementData
    })
  }, [entries])
  
  return mostVisible
}