'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/lib/store'

export default function HomePage() {
  const router = useRouter()
  const { token, isHydrated } = useAuthStore()

  useEffect(() => {
    // Only redirect after hydration completes
    if (isHydrated) {
      if (token) {
        router.replace('/bookshelf')
      } else {
        router.replace('/login')
      }
    }
  }, [token, isHydrated, router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900">
      <div className="text-white text-xl">加载中...</div>
    </div>
  )
}
