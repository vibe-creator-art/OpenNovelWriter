'use client'

import { BookOpen } from 'lucide-react'

interface NovelLoadingOverlayProps {
    novelTitle?: string
    isVisible: boolean
}

export function NovelLoadingOverlay({ novelTitle, isVisible }: NovelLoadingOverlayProps) {
    return (
        <div
            aria-hidden={!isVisible}
            className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-stone-100 transition-opacity duration-300 ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                }`}
        >
            {/* Loading Animation Container */}
            <div className="relative flex items-center justify-center mb-8">
                {/* Rotating Dashed Lines - using inline style for animation */}
                <div
                    className="absolute w-28 h-28"
                    style={{
                        animation: 'spin 3s linear infinite'
                    }}
                >
                    <svg className="w-full h-full" viewBox="0 0 112 112">
                        {/* Top-left corner arc */}
                        <path
                            d="M 28 12 Q 12 12 12 28"
                            fill="none"
                            stroke="#9ca3af"
                            strokeWidth="2"
                            strokeDasharray="6 4"
                            strokeLinecap="round"
                        />
                        {/* Top-right corner arc */}
                        <path
                            d="M 84 12 Q 100 12 100 28"
                            fill="none"
                            stroke="#9ca3af"
                            strokeWidth="2"
                            strokeDasharray="6 4"
                            strokeLinecap="round"
                        />
                        {/* Bottom-right corner arc */}
                        <path
                            d="M 100 84 Q 100 100 84 100"
                            fill="none"
                            stroke="#9ca3af"
                            strokeWidth="2"
                            strokeDasharray="6 4"
                            strokeLinecap="round"
                        />
                        {/* Bottom-left corner arc */}
                        <path
                            d="M 28 100 Q 12 100 12 84"
                            fill="none"
                            stroke="#9ca3af"
                            strokeWidth="2"
                            strokeDasharray="6 4"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>

                {/* Center Icon Container */}
                <div className="relative w-20 h-20 bg-white rounded-2xl shadow-lg flex items-center justify-center z-10">
                    <BookOpen className="w-10 h-10 text-gray-700" strokeWidth={1.5} />
                </div>

                {/* Decorative Sparkle */}
                <div className="absolute -top-1 -right-1 z-20 animate-pulse">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <path
                            d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z"
                            fill="#f59e0b"
                            stroke="#f59e0b"
                            strokeWidth="0.5"
                        />
                    </svg>
                </div>
            </div>

            {/* Title Text */}
            <h2 className="text-xl font-medium text-gray-800 mb-2">
                AI 小说创作平台
            </h2>

            {/* Loading Text */}
            <p className="text-gray-500 flex items-center gap-1">
                {novelTitle ? `正在打开《${novelTitle}》` : '灵感汇聚中'}
                <span className="animate-pulse">...</span>
            </p>

            {/* Inline keyframes for the spin animation */}
            <style jsx>{`
                @keyframes spin {
                    from {
                        transform: rotate(0deg);
                    }
                    to {
                        transform: rotate(360deg);
                    }
                }
            `}</style>
        </div>
    )
}
