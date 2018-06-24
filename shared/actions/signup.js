// @flow
import logger from '../logger'
import * as Constants from '../constants/signup'
import * as LoginGen from './login-gen'
import * as SignupGen from './signup-gen'
import * as Saga from '../util/saga'
import * as RPCTypes from '../constants/types/rpc-gen'
import HiddenString from '../util/hidden-string'
import {trim} from 'lodash-es'
import {isMobile} from '../constants/platform'
import {isValidEmail, isValidName, isValidUsername} from '../util/simple-validators'
import {loginTab} from '../constants/tabs'
import {navigateAppend, navigateTo} from '../actions/route-tree'
import type {RPCError} from '../engine/types'
import type {TypedState} from '../constants/reducer'

const checkInviteCode = (action: SignupGen.CheckInviteCodePayload) =>
  Saga.call(
    RPCTypes.signupCheckInvitationCodeRpcPromise,
    {invitationCode: action.payload.inviteCode},
    Constants.waitingKey
  )
const checkInviteCodeSuccess = () => Saga.put(navigateTo([loginTab, 'signup', 'usernameAndEmail']))
const checkInviteCodeError = () =>
  Saga.put(SignupGen.createCheckInviteCodeDoneError({errorText: "Sorry, that's not a valid invite code."}))

const requestAutoInvite = () =>
  Saga.call(RPCTypes.signupGetInvitationCodeRpcPromise, undefined, Constants.waitingKey)
const requestAutoInviteSuccess = (inviteCode: string) =>
  Saga.put(SignupGen.createCheckInviteCode({inviteCode}))
const requestAutoInviteError = () => Saga.put(navigateTo([loginTab, 'signup', 'inviteCode']))

const requestInvite = (action: SignupGen.RequestInvitePayload) => {
  const {email, name} = action.payload
  const emailError = isValidEmail(email)
  const nameError = isValidName(name)
  if (emailError) {
    return Saga.put(SignupGen.createRequestInviteDoneError({email, emailError, name, nameError: ''}))
  }
  if (nameError) {
    return Saga.put(SignupGen.createRequestInviteDoneError({email, emailError: '', name, nameError}))
  }

  return Saga.call(
    RPCTypes.signupInviteRequestRpcPromise,
    {email: email, fullname: name, notes: 'Requested through GUI app'},
    Constants.waitingKey
  )
}

const requestInviteSuccess = (
  result: SignupGen.RequestInviteDonePayload | void,
  action: SignupGen.RequestInvitePayload
) => {
  // rpc returns undefined, dispatches above on error return the type
  if (result) {
    return
  }
  const {email, name} = action.payload
  return Saga.sequentially([
    Saga.put(SignupGen.createRequestInviteDone({email, name})),
    Saga.put(navigateAppend(['requestInviteSuccess'], [loginTab, 'signup'])),
  ])
}

const requestInviteError = (err, action: SignupGen.RequestInvitePayload) => {
  const {email, name} = action.payload
  return Saga.put(SignupGen.createRequestInviteDoneError({email, emailError: err, name, nameError: ''}))
}

const checkUsernameEmail = (action: SignupGen.CheckUsernameEmailPayload) => {
  const {email, username} = action.payload
  const emailError = isValidEmail(email)
  if (emailError) {
    return Saga.put(
      SignupGen.createCheckUsernameEmailDoneError({
        email,
        emailError,
        username,
        usernameError: '',
      })
    )
  }
  const usernameError = isValidUsername(username)
  if (usernameError) {
    return Saga.put(
      SignupGen.createCheckUsernameEmailDoneError({
        email,
        emailError: '',
        username,
        usernameError,
      })
    )
  }

  return Saga.call(RPCTypes.signupCheckUsernameAvailableRpcPromise, {username}, Constants.waitingKey)
}

const checkUsernameEmailSuccess = (
  result: SignupGen.CheckUsernameEmailDonePayloadError | void,
  action: SignupGen.CheckUsernameEmailPayload
) => {
  // rpc returns undefined, dispatches above on error return the type
  if (result) {
    return
  }
  const {email, username} = action.payload
  return Saga.sequentially([
    Saga.put(SignupGen.createCheckUsernameEmailDone({email, username})),
    Saga.put(navigateAppend(['passphraseSignup'], [loginTab, 'signup'])),
  ])
}

const checkUsernameEmailError = (
  err: {email: string, username: string} | RPCError,
  action: SignupGen.CheckUsernameEmailPayload
) => {
  const {email, username} = action.payload
  if (err.email) {
    const e: {email: string} = (err: any)
    return Saga.put(
      SignupGen.createCheckUsernameEmailDoneError({
        email,
        emailError: e.email,
        username,
        usernameError: '',
      })
    )
  } else if (err.username) {
    const e: {username: string} = (err: any)
    return Saga.put(
      SignupGen.createCheckUsernameEmailDoneError({
        email,
        emailError: '',
        username: username,
        usernameError: e.username,
      })
    )
  } else {
    const e: RPCError = (err: any)
    return Saga.put(
      SignupGen.createCheckUsernameEmailDoneError({
        email,
        emailError: '',
        username,
        usernameError: `Sorry, there was a problem: ${e.desc}`,
      })
    )
  }
}

const checkPassphrase = (action: SignupGen.CheckPassphrasePayload) => {
  const {pass1, pass2} = action.payload
  const p1 = pass1.stringValue()
  const p2 = pass2.stringValue()
  if (!p1 || !p2) {
    return Saga.put(
      SignupGen.createCheckPassphraseDoneError({error: new HiddenString('Fields cannot be blank')})
    )
  } else if (p1 !== p2) {
    return Saga.put(
      SignupGen.createCheckPassphraseDoneError({error: new HiddenString('Passphrases must match')})
    )
  } else if (p1.length < 6) {
    return Saga.put(
      SignupGen.createCheckPassphraseDoneError({
        error: new HiddenString('Passphrase must be at least 6 characters long'),
      })
    )
  }

  return Saga.sequentially([
    Saga.put(SignupGen.createCheckPassphraseDone({passphrase: new HiddenString(p1)})),
    Saga.put(navigateAppend(['deviceName'], [loginTab, 'signup'])),
  ])
}

const submitDevicename = (action: SignupGen.SubmitDevicenamePayload) => {
  const {devicename} = action.payload
  if (trim(devicename).length === 0) {
    return Saga.put(
      SignupGen.createSubmitDevicenameDoneError({
        devicename,
        error: 'Device name must not be empty.',
      })
    )
  }
  return Saga.call(RPCTypes.deviceCheckDeviceNameFormatRpcPromise, {name: devicename}, Constants.waitingKey)
}

const submitDevicenameSuccess = () => Saga.put(SignupGen.createSignup())
const submitDevicenameError = (err: RPCError, action: SignupGen.SubmitDevicenamePayload) => {
  logger.warn('device name is invalid: ', err)
  return Saga.put(
    SignupGen.createSubmitDevicenameDoneError({
      devicename: action.payload.devicename,
      error: `Device name is invalid: ${err.desc}.`,
    })
  )
}

const signup = (action: SignupGen.SignupPayload, state: TypedState) => {
  const {email, username, inviteCode, passphrase, devicename} = state.signup

  console.log('aaa', email, username, inviteCode, passphrase && passphrase.stringValue(), devicename)

  // RPCTypes.signupSignupRpcSaga (
  // {
  // incomingCallMap: {
  // 'keybase.1.gpgUi.wantToAddGPGKey': (params, response) => {
  // // Do not add a gpg key for now
  // response.result(false)
  // },
  // 'keybase.1.loginUi.displayPrimaryPaperKey': ({sessionID, phrase}, response) => {
  // // We dont show the paperkey anymore
  // response.result()
  // dispatch(navigateAppend(['success'], [loginTab, 'signup']))
  // },
  // },
  // deviceName: devicename,
  // deviceType: isMobile ? RPCTypes.commonDeviceType.mobile : RPCTypes.commonDeviceType.desktop,
  // email,
  // genPGPBatch: false,
  // genPaper: false,
  // inviteCode,
  // passphrase: passphrase.stringValue(),
  // skipMail: false,
  // storeSecret: true,
  // username,
  // },
  // Constants.waitingKey
  // )
  // .then(({passphraseOk, postOk, writeOk}) => {
  // logger.info('Successful signup', passphraseOk, postOk, writeOk)
  // })
  // .catch(err => {
  // logger.warn('error in signup:', err)
  // dispatch(SignupGen.createSignupError({signupError: new HiddenString(err.desc)}))
  // dispatch(navigateAppend(['signupError'], [loginTab, 'signup']))
  // })
  // } else {
  // logger.warn('Entered signup action with a null required field')
  // }
  // }
}

const signupSuccess = () => {}
const signupError = () => {}

const resetNav = () => Saga.put(LoginGen.createNavBasedOnLoginAndInitialState())

const signupSaga = function*(): Saga.SagaGenerator<any, any> {
  yield Saga.safeTakeEveryPure(SignupGen.restartSignup, resetNav)
  yield Saga.safeTakeEveryPure(
    SignupGen.checkUsernameEmail,
    checkUsernameEmail,
    checkUsernameEmailSuccess,
    checkUsernameEmailError
  )
  yield Saga.safeTakeEveryPure(
    SignupGen.requestInvite,
    requestInvite,
    requestInviteSuccess,
    requestInviteError
  )
  yield Saga.safeTakeEveryPure(
    SignupGen.requestAutoInvite,
    requestAutoInvite,
    requestAutoInviteSuccess,
    requestAutoInviteError
  )
  yield Saga.safeTakeEveryPure(
    SignupGen.checkInviteCode,
    checkInviteCode,
    checkInviteCodeSuccess,
    checkInviteCodeError
  )
  yield Saga.safeTakeEveryPure(SignupGen.checkPassphrase, checkPassphrase)
  yield Saga.safeTakeEveryPure(
    SignupGen.submitDevicename,
    submitDevicename,
    submitDevicenameSuccess,
    submitDevicenameError
  )
  yield Saga.safeTakeEveryPure(SignupGen.signup, signup, signupSuccess, signupError)
}

export default signupSaga
