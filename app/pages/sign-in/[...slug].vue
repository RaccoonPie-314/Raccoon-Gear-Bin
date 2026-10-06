<template>
  <div class="flex min-h-screen items-center justify-center">
    <!-- Clerk's prebuilt component in path-routing mode: it renders the form at `/sign-in` and
         automatically renders its own handler for `/sign-in/sso-callback` and factor sub-routes. -->
    <SignIn path="/sign-in" routing="path" fallback-redirect-url="/account" />
  </div>
</template>
