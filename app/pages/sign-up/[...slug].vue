<template>
  <div class="flex min-h-screen items-center justify-center">
    <!-- Same as sign-in/[...slug].vue: path routing so Clerk's component handles its own
         `/sign-up/sso-callback` and factor sub-routes. -->
    <SignUp path="/sign-up" routing="path" fallback-redirect-url="/account" />
  </div>
</template>
