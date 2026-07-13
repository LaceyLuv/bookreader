import { expect, test } from 'vitest'
import { readApiProblem, readErrorDetail } from './readErrorDetail'

function jsonResponse(body, status = 400) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

test('normalizes structured API diagnostics without dropping recovery metadata', async () => {
    const problem = await readApiProblem(jsonResponse({
        detail: {
            code: 'zip.invalid_archive',
            message: 'The ZIP archive is damaged.',
            severity: 'error',
            stage: 'archive',
            retryable: false,
            recovery: 'choose_another_file',
            context: { member_name: 'page-1.jpg' },
        },
    }, 422), 'Could not open book')

    expect(problem).toEqual({
        code: 'zip.invalid_archive',
        message: 'The ZIP archive is damaged.',
        severity: 'error',
        stage: 'archive',
        retryable: false,
        recovery: 'choose_another_file',
        context: { member_name: 'page-1.jpg' },
        status: 422,
    })
})

test('keeps legacy string details compatible', async () => {
    const response = jsonResponse({ detail: 'Legacy failure detail' }, 400)

    expect((await readApiProblem(response)).message).toBe('Legacy failure detail')
    expect(await readErrorDetail(response)).toBe('Legacy failure detail')
})

test('uses plain text and status-based retry defaults when no diagnostic object exists', async () => {
    const transient = await readApiProblem(new Response('Service unavailable', { status: 503 }))
    const validation = await readApiProblem(new Response('', { status: 400 }), 'Could not open book')

    expect(transient).toMatchObject({ message: 'Service unavailable', retryable: true, status: 503 })
    expect(validation).toMatchObject({ message: 'Could not open book (HTTP 400)', retryable: false, status: 400 })
})
