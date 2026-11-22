<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/moonwitness-dx-dark.jpg">
    <img alt="moonwitness-dx: sen ve kodlama ajanların için minik bir kanban panosu" src="docs/img/moonwitness-dx-light.jpg">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/A-L-L-A-H/mw-xv/actions/workflows/ci.yml"><img src="https://github.com/A-L-L-A-H/mw-xv/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://crates.io/crates/moonwitness-dx"><img src="https://img.shields.io/crates/v/moonwitness-dx" alt="crates.io"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0"></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a> | Türkçe
</p>

> [!NOTE]
> Bu, topluluk tarafından yapılmış bir çeviridir. En güncel bilgi için [İngilizce README](README.md)'ye bakın.

moonwitness-dx, tarayıcında çalışan bir kanban panosuyla bir MCP sunucusunu tek bir 4,7 MB'lık programda birleştirir; böylece sen ve kodlama ajanların aynı görevler üzerinde çalışırsınız: tek bir bilgisayarda ya da hepsinin paylaştığı tek bir panoda. Hesap yok, sunucu yok, kurulum yok: `moonwitness-dx` komutunu çalıştır, çalışır.

Hiçbir dosyayı elle düzenlemezsin. Her şey şu üç yerden birinde yapılır:

- **pano**, tarayıcında, senin için;
- **MCP**, ajanların için: görev alırlar, kartları taşırlar ve yorum yazarlar;
- **`moonwitness-dx` komutu**, terminal ve betikler için.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/board-dark.gif">
  <img alt="moonwitness-dx panosu: sen izlerken ajanlar kartları taşıyor, ⌘K herhangi bir projedeki görevi buluyor, bir görev başka birini bekleyecek şekilde ayarlanıyor, seçilen iki görev birlikte sürükleniyor, liste görevleri duruma göre grupluyor, kenar çubuğu daralıyor, Dizüstü A panoyu paylaşıyor ve Dizüstü B katılıyor; paylaşılan projeler kenar çubuğunda kendi projelerinin altında görünüyor" src="docs/img/board-light.gif">
</picture>

## Kurulum

> [!TIP]
> **Ajanına söylemen yeterli:** *"github.com/A-L-L-A-H/mw-xv adresinden moonwitness-dx'i kur."*

```sh
curl -LsSf https://github.com/A-L-L-A-H/mw-xv/releases/latest/download/moonwitness-dx-installer.sh | sh
```

macOS ve Linux için; bütün Raspberry Pi modelleri dahil. Windows'ta PowerShell'de:

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/A-L-L-A-H/mw-xv/releases/latest/download/moonwitness-dx-installer.ps1 | iex"
```

İkisi de moonwitness-dx'i `PATH`'ine ekler; bundan sonra açacağın terminallerde geçerli olur. Kurulumu yaptığın terminalde kullanmak için `source $HOME/.cargo/env` çalıştır (fish'te `env.fish`) ya da yeni bir terminal aç.

Ya da [son sürümden](https://github.com/A-L-L-A-H/mw-xv/releases/latest) Windows zip dosyasını indir ve `moonwitness-dx.exe`'yi `PATH`'inde bulunan `bin` adlı bir klasöre koy, örneğin `%USERPROFILE%\.cargo\bin`: pano kendini yalnızca orada güncelleyebilir.

Her sürüm GitHub tarafından imzalanır: indirdiğin dosyayı `gh attestation verify <dosya> --repo A-L-L-A-H/mw-xv` ile doğrula. Ya da Cargo ile:

```sh
cargo install moonwitness-dx
```

## Başlat

> [!TIP]
> **Ajanına söylemen yeterli:** *"moonwitness-dx'i başlat ve oturum açınca çalışır halde kalsın."*

```sh
moonwitness-dx
```

Pano http://localhost:4242 adresinde açılır. Bütün kurulum bundan ibaret: ilk çalıştırma `~/moonwitness-dx` klasörünü oluşturur ve panonun tamamı orada durur.

| Tuş | Ne yapar |
| --- | --- |
| `n` | Yeni görev |
| `/` ya da `⌘K` | Bütün projelerde ara |
| `f` | Panoyu filtrele; `↵` filtreyi korur |
| `Tab` | Açıklamaya geç |
| `⌘↵` | Kaydet ve kapat |
| `Esc` | Açıklamaya ya da etiketlere yazdığını korur; diğer alanlarda iptal eder |

## Panoyu kullan

> [!TIP]
> **Ajanına söylemen yeterli:** *"moonwitness-dx#12'yi human olarak işaretle ve URL'sini github.com/acme/api/pull/482 yap."*

- **Görev seçme:** `⌘` ile tıkla ya da panonun boş bir yerinde sürükle; sonra hepsini birlikte taşı, etiketle ya da sil. Birini sürüklersen diğerleri de peşinden gelir.
- **Liste görünümü:** liste simgesi aynı görevleri sıralanıp gruplanabilen satırlar olarak gösterir.
- **İnsan görevleri:** bir görevi Human olarak işaretlersen ajanlar onu sana bırakır. Kişi simgesi yalnızca bunları gösterir.
- **Görseller:** bir göreve ya da yoruma yapıştır veya sürükleyip bırak.
- **Başka projeye taşıma:** görev panelinden projeyi seç. Numarası aynı kalır, yani `api#12` `web#12` olur. Ajanlar bunu `project` ile taşır.
- **Bağlantılar:** göreve bir URL ver (örneğin pull request'i) ve kartından aç. Ajanlar bunu `url` ile ayarlar.
- **Dosyalar:** bir açıklamada ya da yorumda `[ad](file:///yol)` editöründe açılır.
- **Görev paneli:** boyutunu değiştirmek için sol kenarını sürükle ya da bütün pencereye genişlet. Varsayılana döndürmek için kenara çift tıkla.
- **Kenar çubuğu:** aramanın yanındaki panel düğmesi onu simgelerine kadar daraltır. Listeyi yeniden sıralamak için bir projeyi sürükle; paylaşılan panoda bu herkes için geçerli olur.
- **Uygulama:** Chrome ya da Edge'de kenar çubuğunun altındaki **Install app** panoyu ayrı bir uygulama yapar. `⌘1`–`⌘8` bir proje seçer, `⌘9` sonuncusunu, `⌘0` hepsini. macOS'ta bundan sonra `moonwitness-dx`, varsayılan portta, sekme yerine bu uygulamayı açar.
- **Güncellemeler:** yeni sürüm çıktığında kenar çubuğu bunu önerir. Tek tıkla kurulur.

## Ajanlarını bağla

> [!TIP]
> **Ajanına söylemen yeterli:** *"moonwitness-dx'i MCP sunucun olarak ekle,"* sonra ajanı yeniden başlat.

```sh
claude mcp add moonwitness-dx --scope user -- moonwitness-dx mcp   # Claude Code
codex mcp add moonwitness-dx -- moonwitness-dx mcp                 # Codex
```

Diğer MCP istemcileri: `moonwitness-dx mcp` çalıştır (Raycast gibi uygulamalar `which moonwitness-dx` ile bulacağın tam yolu ister) ya da çalışan panonun `http://localhost:4242/mcp` adresini kullan.

Sonra şunu iste: *"moonwitness-dx'den sıradaki görevi al ve yap."* Ajan:

- projeyi, bulunduğu reponun git remote adresinden bulur; projenin ⋯ menüsünden başka repolar da bağlayabilirsin;
- kartı `doing` sütununa taşır ve çalışırken yorum yazar;
- `review` aşamasında, oturumuna nasıl devam edileceğini yorum olarak yazar.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/task-dark.jpg">
  <img alt="Panoda açık bir görev: Claude Code'un yorumları, bunlardan biri oturumuna nasıl devam edileceğini söylüyor, altında bir yanıt" src="docs/img/task-light.jpg">
</picture>

## Fikirleri backlog'a park et

Settings'te Backlog'u açarsan ajanların dokunmadığı bir sütun gelir; görevlerini `todo` sütununa taşıyana kadar orada bekler.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/backlog-dark.jpg">
  <img alt="Backlog sütunu açık pano, Todo sütununun solunda" src="docs/img/backlog-light.jpg">
</picture>

## Bir görevi başkalarını beklet

> [!TIP]
> **Ajanına söylemen yeterli:** *"moonwitness-dx#12, #10 ve #11'i beklesin."*

- **Ayarlama:** görevin panelindeki Waits on alanına yaz; projedeki görevleri bulup seç. Ajanlar `waits_on` gönderir.
- **O görevler bitene kadar:** `next_task` onu atlar; kartı soluk görünür ve neyi beklediğini yazar. Sen yine de elle taşıyabilirsin.
- **Ne sayılır:** yalnızca `done`. `review` aşamasındaki bir görev hâlâ engeller.
- **Bulma:** `is:waiting` ile filtrele.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/waits-dark.jpg">
  <img alt="Bir görevin paneli: Waits on alanına log yazılmış, seçmek için iki görev öneriliyor; yanında Waits on #7 yazan soluk bir kart" src="docs/img/waits-light.jpg">
</picture>

## Filtrele ve ara

> [!TIP]
> **Ajanına söylemen yeterli:** *"billing etiketli sıradaki moonwitness-dx görevini al,"* ya da *"moonwitness-dx'de tag:billing ile kalanları listele."*

Panonun filtresi (`f`), arama (`/`) ve `list_tasks` ile `next_task`'ın `filter` parametresi aynı sözcükleri anlar, GitHub'daki gibi:

- Her parça eşleşmelidir.
- `-` bir niteleyiciyi tersine çevirir: `tag:billing -status:done`.
- Niteleyiciler yazarken maviye döner.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/filter-dark.jpg">
  <img alt="Kayıtlı tag:backend çipi ve filtre kutusunda is:waiting ile filtrelenmiş pano; eşleşen iki görev, her biri neyi beklediğini söylüyor" src="docs/img/filter-light.jpg">
</picture>

| Niteleyici | Bulduğu | Örnek |
| --- | --- | --- |
| `tag:` | tam olarak o etiket | `tag:bug`, `tag:"needs review"` |
| `status:` | bir sütun | `status:doing` |
| `project:` | bir proje | `project:api` |
| `title:`, `description:`, `url:`, `comment:` | o alandaki metin | `title:login`, `comment:"on hold"` |
| `id:`, `comments:`, `images:` | bir sayı ya da aralık | `id:12`, `comments:>2`, `images:1..3` |
| `created:`, `updated:` | bir tarih ya da aralık | `created:2026-11-05`, `updated:<2026-01-31` |
| `is:human` | ajanlara değil, sana ait görevler | `-is:human` |
| `is:waiting` | bitmemiş görevleri bekleyen görevler | `-is:waiting` |
| `has:`, `no:` | `description`, `tags`, `url`, `comments` ya da `images` | `has:url`, `no:tags` |

Geri kalan her şey düz metindir. Bir ifade için tırnak kullan, `"on hold"`; niteleyiciye benzeyen bir metni aramak için de, `"tag:bug"`. Ajanlar, Settings'te gizlediğin bir özellik üzerinden filtreleme yapamaz.

## Birden çok bilgisayarda kullan

İki yol var, ikisi de kurulum gerektirmez: tek panoyu canlı paylaş ya da makineler arasında eşitle.

### Canlı paylaş

> [!TIP]
> **Ajanına söylemen yeterli:** bir bilgisayarda *"moonwitness-dx panomu paylaş,"* diğerlerinde *"192.168.1.20 adresindeki moonwitness-dx panosuna katıl."*

Birden çok bilgisayar, tek pano, aynı anda: herkes aynı görevleri görür ve her ajan onlar üzerinde çalışır.

1. Panonun bulunduğu bilgisayarda New task'ın yanındaki paylaşma simgesine tıkla ve **Share this board**'u aç. Gösterdiği adreslerden birini kopyala.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/share-dark.jpg">
  <img alt="Panonun bulunduğu bilgisayardaki paylaşma penceresi: paylaşım açık, kopyalanacak adresler ve bağlı bilgisayarlar" src="docs/img/share-light.jpg">
</picture>

2. Diğer her bilgisayarda paylaşma simgesine tıkla, adresi yapıştır ve **Join**'e tıkla.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/join-dark.jpg">
  <img alt="Paylaşılan panoya bağlı başka bir bilgisayar: kenar çubuğu önce bu bilgisayarın projelerini, sonra paylaşılan panonunkileri listeliyor; paylaşma penceresinde Leave düğmesi var" src="docs/img/join-light.jpg">
</picture>

Hiçbir şey yeniden başlamaz ve hiçbir şeyi ayarlamak gerekmez. Kenar çubukları, paylaşılan panonun projelerini kendi projelerinin altında gösterir, böylece özel projeleri bir tık uzakta kalır; ajanları da paylaşılan panoyu aynı `moonwitness-dx mcp` üzerinden kullanır ve projeyi hâlâ çalıştıkları repodan bulur. Paylaşımı istediğin an kapat ya da **Leave**'e tıkla.

Terminalden ya da bir ajan için bu `moonwitness-dx share on` ve `moonwitness-dx join <adres>`, sonra da `moonwitness-dx share off` ve `moonwitness-dx leave` komutlarıdır.

Pano nerede durursa dursun aynı iki komut çalışır; yalnızca adres değişir:

**Senin bilgisayarın panosunu paylaşır.** Diğerleri aynı ağda, kendi bilgisayarlarından katılır.

```mermaid
flowchart LR
  B["💻 Laptop B<br><code>moonwitness-dx#nbsp;join#nbsp;192.168.1.20</code>"] -- home network --> A["💻 Laptop A<br><i>192.168.1.20</i><br><code>moonwitness-dx#nbsp;share#nbsp;on</code>"]
```

**Panoyu bir Raspberry Pi tutar.** Her bilgisayar ona katılır ve hiçbirinin açık kalması gerekmez.

```mermaid
flowchart LR
  A["💻 Laptop A<br><code>moonwitness-dx#nbsp;join#nbsp;192.168.1.50</code>"] -- home network --> pi["🍓 Raspberry Pi<br><i>192.168.1.50</i><br><code>moonwitness-dx#nbsp;share#nbsp;on</code>"]
  B["💻 Laptop B<br><code>moonwitness-dx#nbsp;join#nbsp;192.168.1.50</code>"] -- home network --> pi
```

**Raspberry Pi başka bir yerde, internet üzerinden.** Pi'ye ve her bilgisayara [Tailscale](https://tailscale.com), [NetBird](https://netbird.io) ya da WireGuard gibi bir VPN kur: `moonwitness-dx share on` o zaman Pi'nin VPN adresini de gösterir.

```mermaid
flowchart LR
  A["💻 Laptop A<br><code>moonwitness-dx#nbsp;join#nbsp;100.101.32.7</code>"] -- VPN --> net(("🌐 Internet"))
  B["💻 Laptop B<br><code>moonwitness-dx#nbsp;join#nbsp;100.101.32.7</code>"] -- VPN --> net
  net -- VPN --> pi["🍓 Raspberry Pi<br><i>100.101.32.7</i><br><code>moonwitness-dx#nbsp;share#nbsp;on</code>"]
```

Bir Pi'de `moonwitness-dx service install`, yeniden başlatmadan sonra panonun çalışmaya devam etmesini sağlar. Oturum açma yoktur: yalnızca güvendiğin bir ağda paylaş.

### Makineler arasında eşitle

> [!TIP]
> **Ajanına söylemen yeterli:** *"moonwitness-dx panomu eşitle,"* ya da ilk seferde *"moonwitness-dx eşitlemesini github.com/sen/moonwitness-dx-data ile kur."*

Sırayla kullandığın makineler arasında panoyu taşımak için, sahibi olduğun özel bir git reposu panoyu eşit tutar.

1. GitHub'da ya da git'in push yapabildiği herhangi bir yerde [boş bir özel repo oluştur](https://github.com/new?name=moonwitness-dx-data&visibility=private).
2. Kenar çubuğunun altındaki Settings'e tıkla, Sync'i seç ve reponun URL'sini yapıştır. moonwitness-dx `~/moonwitness-dx`'yu bir git reposu yapar ve panoyu push eder.
3. Diğer her makinede aynı URL ile aynısını yap: moonwitness-dx orada zaten bulunan panoyu kullanmayı önerir.

Bundan sonra makine değiştirdiğinde Sync'i seç ya da `moonwitness-dx sync` çalıştır. Panoyu commit eder, pull ya da push yapar; pano ve ajanların çalışırken de güvenlidir. İki makine de panoyu değiştirdiyse moonwitness-dx hangisinin kalacağını sorar. Başka bir repoya geçmek için Settings'te, Sync altında değiştir.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `moonwitness-dx` | Panoyu http://localhost:4242 adresinde başlatır ve açar; başka port için `--port`, açmamak için `--no-open` |
| `moonwitness-dx service install` | Panoyu çalışır tutar ve oturum açılınca başlatır; `uninstall` kaldırır |
| `moonwitness-dx mcp` | Ajanlar için MCP sunucusu: onu sen değil, ajanlar başlatır |
| `moonwitness-dx share on` | Panoyu ağındaki diğer bilgisayarlarla paylaşır; `off` paylaşımı durdurur, pano çalışmaya devam eder |
| `moonwitness-dx join <ip>` | Başka bir bilgisayarın paylaştığı panoyu bu bilgisayarın panosundan ve ajanlarından kullanır; `moonwitness-dx leave` geri döner |
| `moonwitness-dx sync` | Panoyu commit eder, pull ya da push yapar; `--repo <url>` repoyu ayarlar, iki taraf da değiştiyse `--keep-local` ya da `--keep-remote` |
| `moonwitness-dx export` | Panoyu Markdown olarak yazdırır; JSON için `-f json`, tek proje için `-p <proje>`, dosyaya kaydetmek için `-o <dosya>` |
| `moonwitness-dx update` | Son sürümü kurar ve panonun hizmetini yeniden başlatır; pano da yeni sürümleri önerir |
| `moonwitness-dx init` | Veri klasörünü oluşturur; ilk çalıştırma da bunu yapar |
| `moonwitness-dx --version` | Sürümü yazdırır |

Her komut, başka bir veri klasörü kullanmak için `--home <klasör>` alır.

## Ayarlar

> [!TIP]
> **Ajanına söylemen yeterli:** *"moonwitness-dx'i 4300 portunda çalıştır."*

Her şey `~/moonwitness-dx` içinde durur: pano `moonwitness-dx.db`'de, ayarlar `config.toml`'da. İkisini de açman gerekmez; başka bir klasör için `--home` ya da `MOONWITNESS_DX_HOME` kullan.

```toml
port = 4242
listen = "127.0.0.1"   # sharing opens the board to your network; "0.0.0.0" keeps it open
mcp_http = true        # MCP at /mcp
editor = "/usr/local/bin/cursor"   # opens file:/// links; on macOS, your text editor without it
```

Bu ayarlar her makinede ayrı kalır: `moonwitness-dx sync` onları dışarıda bırakır.

Panodaki ayarlar:

- **Görev özellikleri:** etiketler ya da yorumlar gibi birini kapatırsan panoda gizlenir ve ajanlara gönderilenlerin dışında kalır. Hiçbir şey silinmez.
- **Dil:** Board altında, İngilizce ya da Çince.
- **Tema:** Board altında, sistem, açık ya da koyu.
- **What's new:** About altında, bu sürümün notları.

## Küçük ve hızlı

| | |
| --- | --- |
| Program | 4,7 MB, SQLite dahil |
| Bellek | boştayken 5 MB, 3.000 görevle 12 MB |
| Başlama | 3 ms |
| 3.000 görevlik pano | tarayıcıda 17 ms'de yüklenir |
| Ajanların araç listesi | yaklaşık 1.000 token, oturum başına bir kez |
| Ajanların yanıtları | 10 ile 60 token arası düz metin |

Apple M4 üzerinde ölçüldü.

## Lisans

[AGPL-3.0](LICENSE): kullan, değiştir ve paylaş; değiştirilmiş bir sürümü ağ üzerinden sunarsan kaynak kodunu da paylaş. Katkı için [CONTRIBUTING](.github/CONTRIBUTING.md)'e bak.

<sub>mcp-name: io.github.A-L-L-A-H/moonwitness-dx</sub>
