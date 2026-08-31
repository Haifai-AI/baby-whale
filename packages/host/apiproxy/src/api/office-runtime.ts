/**
 * office-runtime domain contract: the managed LibreOffice runtime's status
 * and one-click install. Status is cheap and answerable any time; install is
 * single-flight host-side — repeat calls while running return the live
 * state. Windows/Linux report a guided flow (their installers need an
 * interactive UI or a package manager), macOS downloads and installs
 * automatically into the app-support directory.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Where the located soffice came from. */
export type SofficeSource = 'managed' | 'system' | 'none'

/** Install lifecycle mirrored from the host-side state machine. */
export interface SofficeInstallView {
  phase: 'idle' | 'downloading' | 'installing' | 'done' | 'error'
  /** 0..1 when the phase has measurable progress. */
  progress: number
  message?: string
  error?: string
}

/** Office-runtime unary methods. */
export interface OfficeRuntimeApi {
  /**
   * Snapshot for the setup banner: whether previews have their LibreOffice
   * runtime, where it came from, the install lifecycle, and — when this
   * platform cannot auto-install — the guided download page.
   */
  status(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<{
    soffice: { found: boolean; source: SofficeSource; path?: string }
    install: SofficeInstallView
    managedSupported: boolean
    guideUrl?: string
  }>>

  /**
   * Begin (or join) the managed install. Returns the state at call time;
   * poll {@link status} for progress.
   */
  install(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<{ install: SofficeInstallView }>>
}
