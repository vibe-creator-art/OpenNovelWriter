import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { saveImageBuffer } from '@/lib/server/storage'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

// POST /api/upload/image - Upload an image
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser(request)
        if (!user) {
            return NextResponse.json({ detail: 'Not authenticated' }, { status: 401 })
        }

        const formData = await request.formData()
        const file = formData.get('file') as File | null

        if (!file) {
            return NextResponse.json({ detail: 'No file provided' }, { status: 400 })
        }

        // Validate file type
        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json(
                { detail: 'Invalid file type. Allowed: jpg, png, gif, webp' },
                { status: 400 }
            )
        }

        // Validate file size
        if (file.size > MAX_SIZE) {
            return NextResponse.json(
                { detail: 'File too large. Maximum size: 5MB' },
                { status: 400 }
            )
        }

        const ext = file.name.split('.').pop() || 'png'
        const buffer = Buffer.from(await file.arrayBuffer())
        const { url, filename } = await saveImageBuffer(buffer, ext)

        return NextResponse.json({ url, filename })
    } catch (error) {
        console.error('Upload error:', error)
        return NextResponse.json({ detail: 'Internal server error' }, { status: 500 })
    }
}
