import type { SiteInfoDraft } from '~/types/site-info'

/** The editor's copy of one social link. `sortOrder` is deliberately absent: position in the
 * list *is* the order, and `socialLinksToColumn` rewrites the stored number from it on save.
 * Both visibility flags are carried, because the editor must be able to say "show it, but don't
 * let anyone order through it" — the two switches are one row's two independent answers.
 *
 * `uid` is client-only identity, and it is what makes a row's DOM node track the row instead of
 * its slot. Without it the list can only be keyed by index, and an index key means a reorder
 * patches one row's fields into another row's element — nothing moves, so no transition has
 * anything to animate, and the two switches and the drag would fight over stale component state.
 * It never reaches the database: `socialLinksToColumn` builds each stored object field by field. */
export type AdminSocialLinkRow = {
  uid: string
  platform: string
  url: string
  enabled: boolean
  contactEnabled: boolean
}

// A monotonic local id, not a crypto uuid: these rows live and die inside one page session, and
// the only thing the id has to guarantee is that two rows are never the same row.
let socialUidSeq = 0
const nextSocialUid = () => `social-${++socialUidSeq}`

export type AdminSiteInfoForm = {
  id: number
  phone: string
  locationUrl: string
  /** locale → label; locales the editor does not render are carried through untouched. */
  locationLabels: Record<string, string>
  socialLinks: AdminSocialLinkRow[]
}

/** The stored singleton is always id 1 (the schema's single-row check); a missing row can only
 * mean it was deleted out-of-band, which the upsert on save also repairs. */
const SINGLETON_ID = 1

const emptyForm = (): AdminSiteInfoForm => ({ id: SINGLETON_ID, phone: '', locationUrl: '', locationLabels: { en: '', km: '' }, socialLinks: [] })

const draftToForm = (draft: SiteInfoDraft): AdminSiteInfoForm => ({
  id: draft.id,
  phone: draft.phone,
  locationUrl: draft.locationUrl,
  locationLabels: Object.fromEntries(draft.locationLabels.map((entry) => [entry.locale, entry.label])),
  socialLinks: draft.socialLinks.map((link) => ({ uid: nextSocialUid(), platform: link.platform, url: link.url, enabled: link.enabled, contactEnabled: link.contactEnabled }))
})

/**
 * The admin site-info editor: the form the Site Info page binds to, the link-row operations,
 * and the singleton save. It follows the product editor's shape on purpose — `canMutate` is a
 * UI guard, and authorization is the claims-path admin policy behind `/api/admin/site-info`,
 * whose `requireAdmin` gate answers first. The storage shapes are not re-implemented here:
 * reads and jsonb conversions come from `useSiteInfo`, the only owner of the `site_settings` row.
 *
 * No catalog state passes through this module, and none of it passes into
 * `useAdminProductEditor` — the two editors stay separate features that happen to share a
 * page-wide visual language.
 */
export const useAdminSiteInfoEditor = (options: { canMutate: () => boolean }) => {
  const { canMutate } = options
  const { fetchSiteInfoDraft, locationLabelsToColumn, socialLinksToColumn } = useSiteInfo()
  const { t } = useI18n()

  const siteForm = ref<AdminSiteInfoForm>(emptyForm())
  const isLoading = ref(true)
  const isSaving = ref(false)
  const actionError = ref('')
  const savedNotice = ref('')

  const loadSiteInfo = async () => {
    isLoading.value = true
    actionError.value = ''
    try {
      const draft = await fetchSiteInfoDraft()
      if (draft) siteForm.value = draftToForm(draft)
    } catch (error: any) {
      actionError.value = error?.message || t('siteInfoLoadError')
    } finally {
      isLoading.value = false
    }
  }

  // A new link starts visible and contactable: the owner narrowing it is an edit, and the row the
  // editor seeds from an old stored link already carries the value the inheritance rule produced.
  const addSocialLink = () => { siteForm.value.socialLinks.push({ uid: nextSocialUid(), platform: '', url: '', enabled: true, contactEnabled: true }) }
  const removeSocialLink = (index: number) => { siteForm.value.socialLinks.splice(index, 1) }
  const moveSocialLink = (index: number, delta: number) => {
    const target = index + delta
    const links = siteForm.value.socialLinks
    const moved = links[index]
    const other = links[target]
    if (!moved || !other) return
    links[index] = other
    links[target] = moved
  }

  // The drag's reorder: move the dragged row to the row the pointer is currently over. It is keyed
  // on the uid rather than on "from, to" indices because the array re-indexes under every move —
  // an index pair captured at dragstart is stale by the second dragover. Returning early when the
  // row is already at that slot is what makes this convergent: the dragged row follows the pointer,
  // so once it lands there the events stop changing anything.
  const reorderSocialLink = (uid: string, toIndex: number) => {
    const links = siteForm.value.socialLinks
    const from = links.findIndex((link) => link.uid === uid)
    const moved = from < 0 ? undefined : links[from]
    if (!moved || from === toIndex) return
    links.splice(from, 1)
    links.splice(toIndex, 0, moved)
  }

  const saveSiteInfo = async () => {
    if (!canMutate()) return
    isSaving.value = true
    actionError.value = ''
    savedNotice.value = ''
    try {
      const payload = {
        id: siteForm.value.id,
        phone: siteForm.value.phone.trim(),
        location_url: siteForm.value.locationUrl.trim(),
        location_translations: locationLabelsToColumn(Object.entries(siteForm.value.locationLabels).map(([locale, label]) => ({ locale, label }))),
        social_links: socialLinksToColumn(siteForm.value.socialLinks)
      }
      await $fetch('/api/admin/site-info', { method: 'POST', body: payload })
      savedNotice.value = t('siteInfoSaved')
      await loadSiteInfo()
    } catch (error: any) {
      actionError.value = error?.data?.message || error?.message || t('siteInfoSaveError')
    } finally {
      isSaving.value = false
    }
  }

  return {
    siteForm,
    isLoading,
    isSaving,
    actionError,
    savedNotice,
    loadSiteInfo,
    saveSiteInfo,
    addSocialLink,
    removeSocialLink,
    moveSocialLink,
    reorderSocialLink
  }
}
