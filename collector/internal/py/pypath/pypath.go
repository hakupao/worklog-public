// Package pypath reproduces Python's two path flavours (posixpath/ntpath and PurePosixPath/
// PureWindowsPath) as host-independent functions (spec §5.7). Go's path/filepath follows the host,
// Python's string functions do not; the caller picks the flavour (HostFlavour(env.GOOS) for the
// pathlib calls Python makes on the host, FlavourOf for clean_paths).
package pypath

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Flavour is posixpath or ntpath.
type Flavour int

const (
	Posix Flavour = iota
	Windows
)

// HostFlavour is the flavour Python's Path takes on a host: WindowsPath on "windows", else PosixPath.
func HostFlavour(goos string) Flavour {
	if goos == "windows" {
		return Windows
	}
	return Posix
}

// FlavourOf is base._flavour (clean_paths): "/"-prefixed is POSIX, anything else Windows.
func FlavourOf(p string) Flavour {
	if strings.HasPrefix(p, "/") {
		return Posix
	}
	return Windows
}

// IsAbsAny is base._is_absolute: "/"-prefixed, or Windows-absolute (^[A-Za-z]:[\\/] or \\).
func IsAbsAny(p string) bool {
	if strings.HasPrefix(p, "/") || strings.HasPrefix(p, `\\`) {
		return true
	}
	return len(p) >= 3 && (p[0] >= 'A' && p[0] <= 'Z' || p[0] >= 'a' && p[0] <= 'z') && p[1] == ':' &&
		(p[2] == '\\' || p[2] == '/')
}

func (f Flavour) sep() string {
	if f == Windows {
		return `\`
	}
	return "/"
}

// splitroot is posixpath.splitroot / ntpath.splitroot (the pure-Python ntpath one, which is what
// the reference ran on the Mac).
func (f Flavour) splitroot(p string) (drive, root, tail string) {
	if f == Posix {
		switch {
		case !strings.HasPrefix(p, "/"):
			return "", "", p
		case !strings.HasPrefix(p[1:], "/") || strings.HasPrefix(p[2:], "/"):
			return "", "/", p[1:]
		default:
			return "", p[:2], p[2:]
		}
	}
	normp := strings.ReplaceAll(p, "/", `\`)
	if strings.HasPrefix(normp, `\`) {
		if !strings.HasPrefix(normp[1:], `\`) {
			return "", p[:1], p[1:]
		}
		// UNC drives (\\server\share, \\?\UNC\server\share) and device drives (\\.\device).
		start := 2
		if len(normp) >= 8 && strings.ToUpper(normp[:8]) == `\\?\UNC\` {
			start = 8
		}
		i := strings.Index(normp[start:], `\`)
		if i < 0 {
			return p, "", ""
		}
		i += start
		j := strings.Index(normp[i+1:], `\`)
		if j < 0 {
			return p, "", ""
		}
		j += i + 1
		return p[:j], p[j : j+1], p[j+1:]
	}
	// normp[1:2] == ":" counts code points: the drive is any one character and a colon.
	_, w := utf8.DecodeRuneInString(normp)
	if len(normp) > w && normp[w] == ':' {
		if len(normp) > w+1 && normp[w+1] == '\\' {
			return p[:w+1], p[w+1 : w+2], p[w+2:]
		}
		return p[:w+1], "", p[w+1:]
	}
	return "", "", p
}

// Join is posixpath.join(a, b) / ntpath.join(a, b).
func (f Flavour) Join(a, b string) string {
	if f == Posix {
		switch {
		case strings.HasPrefix(b, "/") || a == "":
			return b
		case strings.HasSuffix(a, "/"):
			return a + b
		default:
			return a + "/" + b
		}
	}
	rDrive, rRoot, rPath := f.splitroot(a)
	pDrive, pRoot, pPath := f.splitroot(b)
	switch {
	case pRoot != "":
		if pDrive != "" || rDrive == "" {
			rDrive = pDrive
		}
		rRoot, rPath = pRoot, pPath
	case pDrive != "" && pDrive != rDrive && pyLower(pDrive) != pyLower(rDrive):
		rDrive, rRoot, rPath = pDrive, pRoot, pPath
	default:
		if pDrive != "" {
			rDrive = pDrive // the same drive in another case
		}
		if rPath != "" && !strings.ContainsAny(rPath[len(rPath)-1:], `\/`) {
			rPath += `\`
		}
		rPath += pPath
	}
	if rPath != "" && rRoot == "" && rDrive != "" && !strings.ContainsAny(rDrive[len(rDrive)-1:], `:\/`) {
		return rDrive + `\` + rPath
	}
	return rDrive + rRoot + rPath
}

// Normpath is posixpath.normpath / ntpath.normpath.
func (f Flavour) Normpath(p string) string {
	if f == Posix {
		if p == "" {
			return "."
		}
		_, initial, rest := f.splitroot(p)
		var comps []string
		for _, c := range strings.Split(rest, "/") {
			if c == "" || c == "." {
				continue
			}
			if c != ".." || (initial == "" && len(comps) == 0) || (len(comps) > 0 && comps[len(comps)-1] == "..") {
				comps = append(comps, c)
			} else if len(comps) > 0 {
				comps = comps[:len(comps)-1]
			}
		}
		if out := initial + strings.Join(comps, "/"); out != "" {
			return out
		}
		return "."
	}
	p = strings.ReplaceAll(p, "/", `\`)
	drive, root, rest := f.splitroot(p)
	prefix := drive + root
	comps := strings.Split(rest, `\`)
	for i := 0; i < len(comps); {
		switch {
		case comps[i] == "" || comps[i] == ".":
			comps = append(comps[:i], comps[i+1:]...)
		case comps[i] == "..":
			switch {
			case i > 0 && comps[i-1] != "..":
				comps = append(comps[:i-1], comps[i+1:]...)
				i--
			case i == 0 && root != "":
				comps = append(comps[:i], comps[i+1:]...)
			default:
				i++
			}
		default:
			i++
		}
	}
	if prefix == "" && len(comps) == 0 {
		comps = append(comps, ".")
	}
	return prefix + strings.Join(comps, `\`)
}

// parse is PurePath._parse_path: drive, root and the tail without empty or "." parts.
func (f Flavour) parse(p string) (drive, root string, tail []string) {
	if p == "" {
		return "", "", nil
	}
	sep := f.sep()
	if f == Windows {
		p = strings.ReplaceAll(p, "/", sep)
	}
	drive, root, rel := f.splitroot(p)
	if root == "" && strings.HasPrefix(drive, sep) && !strings.HasSuffix(drive, sep) {
		parts := strings.Split(drive, sep)
		if (len(parts) == 4 && !strings.Contains("?.", parts[2])) || len(parts) == 6 {
			root = sep // \\server\share, \\?\UNC\server\share
		}
	}
	for _, x := range strings.Split(rel, sep) {
		if x != "" && x != "." {
			tail = append(tail, x)
		}
	}
	return drive, root, tail
}

// format is PurePath._format_parsed_parts, with str()'s "." for an empty path.
func (f Flavour) format(drive, root string, tail []string) string {
	sep := f.sep()
	if drive != "" || root != "" {
		return drive + root + strings.Join(tail, sep)
	}
	if len(tail) > 0 && f == Windows {
		if d, _, _ := f.splitroot(tail[0]); d != "" && !strings.HasPrefix(d, sep) {
			tail = append([]string{"."}, tail...)
		}
	}
	if s := strings.Join(tail, sep); s != "" {
		return s
	}
	return "."
}

// str is str(PurePath(p)).
func (f Flavour) str(p string) string {
	d, r, t := f.parse(p)
	return f.format(d, r, t)
}

// normcase is PurePath._str_normcase: str(p), lower-cased for Windows.
func (f Flavour) normcase(p string) string {
	if f == Windows {
		return pyLower(f.str(p))
	}
	return f.str(p)
}

// Parts is PurePath(p).parts.
func (f Flavour) Parts(p string) []string {
	drive, root, tail := f.parse(p)
	if drive != "" || root != "" {
		return append([]string{drive + root}, tail...)
	}
	return tail
}

// Less is PurePath ordering (sorted(paths)): the normcase string split on the separator, compared
// component by component in code-point order; Windows compares lower-cased components.
func (f Flavour) Less(a, b string) bool {
	pa := strings.Split(f.normcase(a), f.sep())
	pb := strings.Split(f.normcase(b), f.sep())
	for i := 0; i < len(pa) && i < len(pb); i++ {
		if pa[i] != pb[i] {
			return pa[i] < pb[i]
		}
	}
	return len(pa) < len(pb)
}

// RelativeTo reports whether Path(p).relative_to(base) succeeds: base equals p or one of p's
// parents (case-insensitively on Windows).
func (f Flavour) RelativeTo(p, base string) bool {
	want := f.normcase(base)
	drive, root, tail := f.parse(p)
	for n := len(tail); n >= 0; n-- {
		s := f.format(drive, root, tail[:n])
		if f == Windows {
			s = pyLower(s)
		}
		if s == want {
			return true
		}
	}
	return false
}

type caseEntry struct {
	cp          rune
	fold, lower string
}

func lookupCase(r rune) (caseEntry, bool) {
	i := sort.Search(len(caseTable), func(i int) bool { return caseTable[i].cp >= r })
	if i < len(caseTable) && caseTable[i].cp == r {
		return caseTable[i], true
	}
	return caseEntry{}, false
}

// Casefold is str.casefold(): full case folding from CPython's own Unicode 16 data (ß → ss,
// ﬁ → fi), not Go's unicode.ToLower.
func Casefold(s string) string {
	var sb strings.Builder
	for _, r := range s {
		if e, ok := lookupCase(r); ok {
			sb.WriteString(e.fold)
		} else {
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

// pyLower is str.lower(): CPython's Unicode 16 lower-case mappings (İ → i̇), with the final-sigma
// rule. The rule's Cased / Case_Ignorable properties come from Go's tables, an approximation only
// for code points the two Unicode versions classify differently.
func pyLower(s string) string {
	var sb strings.Builder
	for i, r := range s {
		if r == 'Σ' {
			if finalSigma(s, i) {
				sb.WriteRune('ς')
			} else {
				sb.WriteRune('σ')
			}
			continue
		}
		if e, ok := lookupCase(r); ok {
			sb.WriteString(e.lower)
		} else {
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

// finalSigma is CPython's handle_capital_sigma for the Σ at byte i:
// \p{cased} \p{case-ignorable}* Σ !(\p{case-ignorable}* \p{cased}).
func finalSigma(s string, i int) bool {
	j := i
	var c rune
	found := false
	for j > 0 {
		var w int
		c, w = utf8.DecodeLastRuneInString(s[:j])
		j -= w
		if !caseIgnorable(c) {
			found = true
			break
		}
	}
	if !found || !cased(c) {
		return false
	}
	for _, c := range s[i+len("Σ"):] {
		if !caseIgnorable(c) {
			return !cased(c)
		}
	}
	return true
}

func cased(r rune) bool {
	return unicode.In(r, unicode.Lu, unicode.Ll, unicode.Lt, unicode.Other_Lowercase, unicode.Other_Uppercase)
}

func caseIgnorable(r rune) bool {
	switch r {
	case '\'', '.', ':', 0xb7, 0x387, 0x55f, 0x5f4, 0x2018, 0x2019, 0x2024, 0x2027, 0xfe13, 0xfe52,
		0xfe55, 0xff07, 0xff0e, 0xff1a: // Word_Break MidLetter / MidNumLet / Single_Quote
		return true
	}
	return unicode.In(r, unicode.Mn, unicode.Me, unicode.Cf, unicode.Lm, unicode.Sk)
}

// Quote is urllib.parse.quote(s) with its default safe="/": UTF-8 bytes, letters, digits and
// "_.-~/" kept, everything else %XX in upper-case hex.
func Quote(s string) string {
	const hex = "0123456789ABCDEF"
	var sb strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.IndexByte("_.-~/", c) >= 0 {
			sb.WriteByte(c)
			continue
		}
		sb.WriteByte('%')
		sb.WriteByte(hex[c>>4])
		sb.WriteByte(hex[c&0xf])
	}
	return sb.String()
}

// Name is PurePath(p).name: the last component after the anchor, "" when there is none.
func (f Flavour) Name(p string) string {
	if _, _, tail := f.parse(p); len(tail) > 0 {
		return tail[len(tail)-1]
	}
	return ""
}
