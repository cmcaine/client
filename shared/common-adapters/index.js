// @flow
import * as React from 'react'
import Box from './box'
import PopupDialog from './popup-dialog'
import {connect} from '../util/container'
import {collapseStyles, globalColors, isMobile} from '../styles'

const MaybePopup = isMobile
  ? (props: {onClose: () => void, children: React.Node}) => (
      <Box style={{height: '100%', width: '100%'}} children={props.children} />
    )
  : (props: {
      onClose: () => void,
      onMouseUp?: (e: SyntheticMouseEvent<>) => void,
      onMouseDown?: (e: SyntheticMouseEvent<>) => void,
      onMouseMove?: (e: SyntheticMouseEvent<>) => void,
      children: React.Node,
      cover?: boolean,
      styleCover?: any,
      styleContainer?: any,
    }) => (
      <PopupDialog
        onClose={props.onClose}
        onMouseUp={props.onMouseUp}
        onMouseDown={props.onMouseDown}
        onMouseMove={props.onMouseMove}
        styleCover={collapseStyles([props.cover && _styleCover, props.styleCover])}
        styleContainer={props.cover ? {..._styleContainer, ...props.styleContainer} : {}}
        children={props.children}
      />
    )

// TODO properly type this
const DispatchNavUpHoc: any = connect(
  () => ({}),
  (dispatch, {navigateUp}) => ({
    connectedNavigateUp: () => dispatch(navigateUp()),
  }),
  (s, d, o) => ({...o, ...s, ...d})
)

// TODO properly type this
const _MaybePopupHoc: any = (cover: boolean) => {
  return WrappedComponent => props => {
    const onClose = props.onClose || props.connectedNavigateUp
    return (
      <MaybePopup onClose={onClose} cover={!!cover}>
        <WrappedComponent onClose={onClose} {...props} />
      </MaybePopup>
    )
  }
}

type MaybePopupHocType<P> = (
  cover: boolean
) => (WrappedComponent: React.ComponentType<P>) => React.ComponentType<P>
const MaybePopupHoc: MaybePopupHocType<any> = (cover: boolean) => Component =>
  DispatchNavUpHoc(_MaybePopupHoc(cover)(Component))

const _styleCover = {
  alignItems: 'stretch',
  backgroundColor: globalColors.black_75,
  justifyContent: 'stretch',
}

const _styleContainer = {
  height: '100%',
}

export {default as Avatar, castPlatformStyles as avatarCastPlatformStyles} from './avatar'
export {default as BackButton} from './back-button'
export {default as Badge} from './badge'
export {default as Banner} from './banner'
export {Box, Box2} from './box'
export {default as ButtonBar} from './button-bar'
export {default as Button} from './button'
export {default as Checkbox} from './checkbox'
export {default as ChoiceList} from './choice-list'
export {default as ClickableBox} from './clickable-box'
export {default as Confirm} from './confirm'
export {default as CopyText} from './copy-text'
export {default as CopyableText} from './copyable-text'
export {default as DesktopStyle} from './desktop-style'
export {default as Divider} from './divider'
export {default as Dropdown} from './dropdown'
export {default as Emoji} from './emoji'
export {default as ErrorBoundary} from './error-boundary'
export {default as FloatingBox} from './floating-box'
export {default as FloatingMenu} from './floating-menu'
export {default as OverlayParentHOC} from './overlay-parent-hoc'
export type {OverlayParentProps} from './overlay-parent-hoc'
export {default as FollowButton} from '../profile/follow-button'
export {default as FormWithCheckbox} from './form-with-checkbox'
export {default as Header} from './header'
export {default as HeaderHoc, HeaderHocHeader} from './header-hoc'
export {default as HeaderOnMobile} from './header-on-mobile'
export {default as HeaderOrPopup} from './header-or-popup'
export {default as HoverHoc} from './hover-hoc'
export {default as Icon, castPlatformStyles as iconCastPlatformStyles} from './icon'
export {default as Image, RequireImage} from './image'
export {default as InfoNote} from './info-note'
export {default as Input} from './input'
export {default as List} from './list'
export {default as LoadingLine} from './loading-line'
export {default as ListItem} from './list-item'
export {default as ListItem2} from './list-item2'
export {default as Markdown} from './markdown'
export {MaybePopup, MaybePopupHoc}
export {default as MultiAvatar} from './multi-avatar.js'
export {default as Meta} from './meta'
export {default as NameWithIcon} from './name-with-icon'
export {default as NewInput} from './new-input'
export {default as OrientedImage} from './oriented-image'
export {default as Overlay} from './overlay'
export {default as PlainInput} from './plain-input'
export {default as PlatformIcon} from './platform-icon'
export {default as PopupDialog} from './popup-dialog'
export {default as PopupDialogHoc} from './popup-dialog-hoc'
export {default as PopupMenu} from './popup-menu'
export {default as ProgressBar} from './progress-bar'
export {default as ProgressIndicator} from './progress-indicator'
export {default as RadioButton} from './radio-button'
export {default as SaveIndicator} from './save-indicator'
export {default as ScrollView} from './scroll-view'
export {default as SectionList} from './section-list'
export {default as StandardScreen} from './standard-screen'
export {default as TabBar} from './tab-bar'
export {default as Tabs} from './tabs'
export {default as Text} from './text'
export {default as Toast} from './toast'
export {default as TimelineMarker} from './timeline-marker'
export {default as UserBio} from './user-bio'
export {default as UserCard} from './user-card'
export {default as UserProofs} from './user-proofs'
export {PlaintextUsernames, Usernames, ConnectedUsernames} from './usernames'
export {default as WaitingButton} from './waiting-button'
export {default as HOCTimers} from './hoc-timers'
export type {PropsWithTimer} from './hoc-timers'
export type {IconType} from './icon.constants'
export {default as WebView} from './web-view'
export type {WebViewProps, WebViewInjections} from './web-view'
export {default as WithTooltip} from './with-tooltip'
