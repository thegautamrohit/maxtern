'use client'

import { useSignIn } from '@clerk/nextjs'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { GoogleLogoIcon } from '@phosphor-icons/react'

type Step = 'form' | 'client_trust'

export default function SignInPage() {
  const { signIn } = useSignIn()
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signIn) return
    setLoading(true)
    setError('')

    const { error: signInError } = await signIn.password({ emailAddress: email, password })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    if (signIn.status === 'complete') {
      const { error: finalizeError } = await signIn.finalize()
      if (finalizeError) {
        setError(finalizeError.message)
        setLoading(false)
      } else {
        router.push('/chat')
      }
    } else if (signIn.status === 'needs_client_trust') {
      // New device — send email code to establish client trust
      const { error: sendError } = await signIn.mfa.sendEmailCode()
      if (sendError) {
        setError(sendError.message)
        setLoading(false)
        return
      }
      setStep('client_trust')
      setLoading(false)
    } else {
      setError('Sign in could not be completed. Please try again.')
      setLoading(false)
    }
  }

  const handleClientTrust = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signIn) return
    setLoading(true)
    setError('')

    const { error: verifyError } = await signIn.mfa.verifyEmailCode({ code })

    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
      return
    }

    if (signIn.status === 'complete') {
      const { error: finalizeError } = await signIn.finalize()
      if (finalizeError) {
        setError(finalizeError.message)
        setLoading(false)
      } else {
        router.push('/chat')
      }
    } else {
      setError('Verification could not be completed. Please try again.')
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    if (!signIn) return
    const origin = window.location.origin
    await signIn.sso({
      strategy: 'oauth_google',
      redirectUrl: `${origin}/sso-callback`,
      redirectCallbackUrl: `${origin}/chat`,
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm bg-card border border-border rounded-xl p-8 flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs tracking-widest uppercase text-primary font-semibold">Maxtern</span>
          <h1 className="text-sm font-semibold">
            {step === 'form' ? 'Sign in' : 'Verify your device'}
          </h1>
        </div>

        {step === 'form' ? (
          <>
            <Button variant="outline" type="button" onClick={handleGoogle} className="w-full gap-2 text-xs">
              <GoogleLogoIcon size={14} />
              Continue with Google
            </Button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="text-xs"
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="text-xs"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" disabled={loading} className="w-full text-xs">
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>

            <p className="text-xs text-muted-foreground text-center">
              Don&apos;t have an account?{' '}
              <Link href="/sign-up" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </>
        ) : (
          <form onSubmit={handleClientTrust} className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              We sent a verification code to{' '}
              <span className="text-foreground">{email}</span> to confirm this device.
            </p>
            <Input
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              className="text-xs tracking-widest"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full text-xs">
              {loading ? 'Verifying...' : 'Verify device'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
