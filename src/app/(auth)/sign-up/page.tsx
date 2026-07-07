'use client'

import { useSignUp } from '@clerk/nextjs'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { GoogleLogoIcon } from '@phosphor-icons/react'

type Step = 'form' | 'verify'

export default function SignUpPage() {
  const { signUp } = useSignUp()
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signUp) return
    setLoading(true)
    setError('')

    const { error: createError } = await signUp.password({
      firstName,
      lastName,
      emailAddress: email,
      password,
    })

    if (createError) {
      setError(createError.message)
      setLoading(false)
      return
    }

    const { error: sendError } = await signUp.verifications.sendEmailCode()

    if (sendError) {
      setError(sendError.message)
      setLoading(false)
      return
    }

    setStep('verify')
    setLoading(false)
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!signUp) return
    setLoading(true)
    setError('')

    const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code })

    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
      return
    }

    if (signUp.status === 'complete') {
      const { error: finalizeError } = await signUp.finalize()
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
    if (!signUp) return
    const origin = window.location.origin
    await signUp.sso({
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
            {step === 'form' ? 'Create account' : 'Verify your email'}
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

            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="text-xs"
                />
                <Input
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="text-xs"
                />
              </div>
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
                {loading ? 'Creating account...' : 'Create account'}
              </Button>
            </form>

            <p className="text-xs text-muted-foreground text-center">
              Already have an account?{' '}
              <Link href="/sign-in" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </>
        ) : (
          <form onSubmit={handleVerify} className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              We sent a 6-digit code to{' '}
              <span className="text-foreground">{email}</span>
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
              {loading ? 'Verifying...' : 'Verify email'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
