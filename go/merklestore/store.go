// Copyright 2017 Keybase, Inc. All rights reserved. Use of
// this source code is governed by the included BSD license.

package merklestore

import (
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"sync"
	"time"

	"github.com/keybase/client/go/libkb"
	"github.com/keybase/client/go/protocol/keybase1"
)

type MerkleStoreError struct {
	msg string
}

func (e MerkleStoreError) Error() string {
	return fmt.Sprintf("MerkleStore: %s", e.msg)
}

func NewMerkleStoreError(msgf string, a ...interface{}) MerkleStoreError {
	return MerkleStoreError{msg: fmt.Sprintf(msgf, a...)}
}

// Bump this to ignore existing cache entries.
const dbVersion = 1

type dbKit struct {
	DBVersion int
	Hash      keybase1.MerkleStoreKitHash
	Kit       keybase1.MerkleStoreKit
}

// MerkleStore is the way verify data stored on the server matches the hash
// which is published in the merkle root. This allows an auditable trail for
// data the clients fetch from the server and use for proof or other
// validation.
// Talks to MerkleClient
// Has an in-memory and LocalDB cache.
type MerkleStoreImpl struct {
	libkb.Contextified
	sync.Mutex

	// human readable tag for logs/error reporting
	tag string

	// server endpoint to fetch stored data
	endpoint string

	// latest supported version
	supportedVersion keybase1.MerkleStoreSupportedVersion

	// getter for merkle hash we want to verify against
	getRootHash func(libkb.MerkleRoot) string

	// path to load kit from a file while debugging, if present this will be
	// used instead of requesting data from the server, helpful for debugging.
	kitFilename string

	mem *dbKit
}

var _ libkb.MerkleStore = (*MerkleStoreImpl)(nil)

func NewMerkleStore(g *libkb.GlobalContext, tag, endpoint, kitFilename string, supportedVersion keybase1.MerkleStoreSupportedVersion,
	getRootHash func(root libkb.MerkleRoot) string) libkb.MerkleStore {
	return &MerkleStoreImpl{
		Contextified:     libkb.NewContextified(g),
		tag:              tag,
		endpoint:         endpoint,
		kitFilename:      kitFilename,
		supportedVersion: supportedVersion,
		getRootHash:      getRootHash,
	}
}

type merkleStoreKitT struct {
	KitVersion int `json:"kit_version"`
	// TODO CORE-8655 add ctime to paramproofs
	Ctime int `json:"ctime"`
	// Versioned entries of the store
	Tab map[int]json.RawMessage `json:"tab"`
}

// GetLatestEntry returns the latest (active) entry for the given MerkleStore
func (s *MerkleStoreImpl) GetLatestEntry(m libkb.MetaContext) (ret keybase1.MerkleStoreEntry, err error) {
	kitJSON, hash, err := s.getKitString(m)
	if err != nil {
		return ret, err
	}

	var kit merkleStoreKitT
	if err = json.Unmarshal([]byte(kitJSON), &kit); err != nil {
		return ret, NewMerkleStoreError("unmarshalling kit: %s", err)
	}

	sub, ok := kit.Tab[int(s.supportedVersion)]
	if !ok {
		return ret, NewMerkleStoreError("missing %s for version: %d", s.tag, s.supportedVersion)
	}
	if len(sub) == 0 {
		return ret, NewMerkleStoreError("empty %s for version: %d", s.tag, s.supportedVersion)
	}

	return keybase1.MerkleStoreEntry{
		Hash:  hash,
		Entry: keybase1.MerkleStoreEntryString(sub),
	}, nil
}

// Get stored kit as a string.  First it makes sure that the merkle root is
// recent enough.  Using the hash from that, it fetches from in-memory falling
// back to db falling back to server.
func (s *MerkleStoreImpl) getKitString(m libkb.MetaContext) (
	keybase1.MerkleStoreKit, keybase1.MerkleStoreKitHash, error) {

	// Use a file instead if specified.
	if len(s.kitFilename) > 0 {
		m.CDebugf("MerkleStore: using kit file: %s", s.kitFilename)
		return s.readFile(s.kitFilename)
	}

	mc := m.G().GetMerkleClient()
	if mc == nil {
		return "", "", NewMerkleStoreError("no MerkleClient available")
	}

	s.Lock()
	defer s.Unlock()

	root := mc.LastRoot()
	// The time that the root was fetched is used rather than when the
	// root was published so that we can continue to operate even if
	// the root has not been published in a long time.
	if (root == nil) || s.pastDue(m, root.Fetched(), libkb.MerkleStoreShouldRefresh) {
		m.CDebugf("MerkleStore: merkle root should refresh")

		// Attempt a refresh if the root is old or nil.
		err := s.refreshRoot(m)
		if err != nil {
			m.CDebugf("MerkleStore: could not refresh merkle root: %s", err)
		} else {
			root = mc.LastRoot()
		}
	}

	if root == nil {
		return "", "", NewMerkleStoreError("no merkle root")
	}

	if s.pastDue(m, root.Fetched(), libkb.MerkleStoreRequireRefresh) {
		// The root is still too old, even after an attempted refresh.
		m.CDebugf("MerkleStore: merkle root too old")
		return "", "", NewMerkleStoreError("merkle root too old: %v %s", seqnoWrap(root.Seqno()), root.Fetched())
	}

	// This is the hash we are being instructed to use.
	hash := keybase1.MerkleStoreKitHash(s.getRootHash(*root))

	if hash == "" {
		return "", "", NewMerkleStoreError("merkle root has empty %s hash: %v", s.tag, seqnoWrap(root.Seqno()))
	}

	// Use in-memory cache if it matches
	if fromMem := s.memGet(hash); fromMem != nil {
		m.CDebugf("MerkleStore: mem cache hit, using hash: %s", hash)
		return *fromMem, hash, nil
	}

	// Use db cache if it matches
	if fromDB := s.dbGet(m, hash); fromDB != nil {
		m.CDebugf("MerkleStore: db cache hit")

		// Store to memory
		s.memSet(hash, *fromDB)

		m.CDebugf("MerkleStore: using hash: %s", hash)
		return *fromDB, hash, nil
	}

	// Fetch from the server
	// This validates the hash
	kitJSON, err := s.fetch(m, hash)
	if err != nil {
		return "", "", err
	}

	// Store to memory
	s.memSet(hash, kitJSON)

	// db write
	s.dbSet(m.BackgroundWithLogTags(), hash, kitJSON)

	m.CDebugf("MerkleStore: using hash: %s", hash)
	return kitJSON, hash, nil
}

type merkleStoreServerRes struct {
	Status  libkb.AppStatus         `json:"status"`
	KitJSON keybase1.MerkleStoreKit `json:"kit_json"`
}

func (r *merkleStoreServerRes) GetAppStatus() *libkb.AppStatus {
	return &r.Status
}

// Fetch data and check the hash.
func (s *MerkleStoreImpl) fetch(m libkb.MetaContext, hash keybase1.MerkleStoreKitHash) (keybase1.MerkleStoreKit, error) {
	m.CDebugf("MerkleStore: fetching from server: %s", hash)
	var res merkleStoreServerRes
	err := m.G().API.GetDecode(libkb.APIArg{
		Endpoint:    s.endpoint,
		SessionType: libkb.APISessionTypeNONE,
		MetaContext: m,
		Args: libkb.HTTPArgs{
			"hash": libkb.S{Val: string(hash)},
		},
	}, &res)
	if err != nil {
		return "", NewMerkleStoreError(err.Error())
	}
	if res.KitJSON == "" {
		return "", NewMerkleStoreError("server returned empty kit for %s", s.tag)
	}
	if s.hash(res.KitJSON) != hash {
		m.CDebugf("%s hash mismatch: got:%s expected:%s", s.tag, s.hash(res.KitJSON), hash)
		return "", NewMerkleStoreError("server returned wrong kit for %s", s.tag)
	}
	return res.KitJSON, nil
}

// updateRoot kicks MerkleClient to update its merkle root
// by doing a LookupUser on some arbitrary user.
func (s *MerkleStoreImpl) refreshRoot(m libkb.MetaContext) error {
	q := libkb.NewHTTPArgs()
	// The user lookup here is unnecessary. It is done because that is what is
	// easy with MerkleClient.  The user looked up is you if known, otherwise
	// arbitrarily t_alice.  If t_alice is removed, this path will break.
	uid := s.G().GetMyUID()
	if len(uid) == 0 {
		// Use t_alice's uid.
		uid = libkb.TAliceUID
	}
	q.Add("uid", libkb.UIDArg(uid))
	_, err := s.G().MerkleClient.LookupUser(m, q, nil)
	return err
}

func (s *MerkleStoreImpl) memGet(hash keybase1.MerkleStoreKitHash) *keybase1.MerkleStoreKit {
	if s.mem != nil {
		if s.mem.Hash == hash {
			ret := s.mem.Kit
			return &ret
		}
	}
	return nil
}

func (s *MerkleStoreImpl) memSet(hash keybase1.MerkleStoreKitHash, kitJSON keybase1.MerkleStoreKit) {
	s.mem = &dbKit{
		DBVersion: dbVersion,
		Hash:      hash,
		Kit:       kitJSON,
	}
}

// Get from local db. Can return nil.
func (s *MerkleStoreImpl) dbGet(m libkb.MetaContext, hash keybase1.MerkleStoreKitHash) *keybase1.MerkleStoreKit {
	db := m.G().LocalDb
	if db == nil {
		return nil
	}
	var entry dbKit
	if found, err := db.GetInto(&entry, s.dbKey()); err != nil {
		m.CDebugf("MerkleStore: error reading from db: %s", err)
		return nil
	} else if !found {
		return nil
	}
	if entry.DBVersion != dbVersion {
		return nil
	}
	if entry.Hash == hash {
		return &entry.Kit
	}
	return nil
}

// Logs errors.
func (s *MerkleStoreImpl) dbSet(m libkb.MetaContext, hash keybase1.MerkleStoreKitHash, kitJSON keybase1.MerkleStoreKit) {
	db := m.G().LocalDb
	if db == nil {
		m.CDebugf("dbSet: no db")
		return
	}
	entry := dbKit{
		DBVersion: dbVersion,
		Hash:      hash,
		Kit:       kitJSON,
	}
	if err := db.PutObj(s.dbKey(), nil, entry); err != nil {
		m.CDebugf("dbSet: %s", err)
	}
}

// hex of sha512
func (s *MerkleStoreImpl) hash(in keybase1.MerkleStoreKit) keybase1.MerkleStoreKitHash {
	buf := sha512.Sum512([]byte(in))
	out := hex.EncodeToString(buf[:])
	return keybase1.MerkleStoreKitHash(out)
}

func (s *MerkleStoreImpl) pastDue(m libkb.MetaContext, event time.Time, limit time.Duration) bool {
	diff := m.G().Clock().Now().Sub(event)
	isOverdue := diff > limit
	if isOverdue {
		m.CDebugf("MerkleStore: pastDue diff:(%s) t1:(%s) limit:(%s)", diff, event, limit)
	}
	return isOverdue
}

func (s *MerkleStoreImpl) readFile(path string) (keybase1.MerkleStoreKit, keybase1.MerkleStoreKitHash, error) {
	buf, err := ioutil.ReadFile(path)
	kitJSON := keybase1.MerkleStoreKit(string(buf))
	return kitJSON, s.hash(kitJSON), err
}

func (s *MerkleStoreImpl) dbKey() libkb.DbKey {
	return libkb.DbKey{
		Typ: libkb.DBMerkleStore,
		Key: s.tag,
	}
}

func seqnoWrap(x *keybase1.Seqno) int64 {
	if x == nil {
		return 0
	}
	return int64(*x)
}
